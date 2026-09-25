const crypto = require('crypto')
const cloud = require('wx-server-sdk')
const { isOwnedCloudFile, sanitizeFootprint, text } = require('./validation')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const footprints = db.collection('footprints')

const validId = (value) => {
  const id = text(value, 100)
  if (id && !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('足迹 ID 不合法')
  return id
}

const ownedFootprint = async (id, openid) => {
  let footprint
  try {
    footprint = (await footprints.doc(id).get()).data
  } catch {
    footprint = undefined
  }
  if (!footprint || footprint._openid !== openid) {
    throw new Error('足迹不存在或无权操作')
  }
  return footprint
}

const publicFootprint = (footprint, id) => {
  const { _openid, _id, ...data } = footprint
  return { ...data, id: id || _id, userId: _openid }
}

const listOwned = async (openid) => {
  const result = []
  let offset = 0
  while (true) {
    const page = (
      await footprints
        .where({ _openid: openid })
        .orderBy('updatedAt', 'desc')
        .skip(offset)
        .limit(100)
        .get()
    ).data
    result.push(...page.map((item) => publicFootprint(item)))
    if (page.length < 100) break
    offset += page.length
  }
  return result
}

const deleteCloudFiles = async (paths, openid) => {
  const cloudPaths = (paths || []).filter((path) => isOwnedCloudFile(path, openid))
  for (let i = 0; i < cloudPaths.length; i += 50) {
    await cloud.deleteFile({ fileList: cloudPaths.slice(i, i + 50) }).catch(() => undefined)
  }
}

const idFromRequest = (openid, requestId) =>
  `fp_${crypto.createHash('sha256').update(`${openid}:${requestId}`).digest('hex').slice(0, 40)}`

exports.main = async (event = {}) => {
  try {
    const { OPENID } = cloud.getWXContext()
    if (!OPENID) throw new Error('登录状态无效')
    const action = event.action

    if (action === 'list') {
      return { ok: true, data: await listOwned(OPENID) }
    }

    if (action === 'create') {
      const input = event.footprint || {}
      if (input.status === 'fulfilled') throw new Error('请通过愿望实现流程创建记录')
      if (input.wishId || input.convertedFromWishlist) throw new Error('请通过愿望实现流程关联到访记录')
      const requestId = text(input.clientRequestId, 100)
      if (!requestId) throw new Error('缺少幂等请求标识')

      const duplicate = await footprints
        .where({ _openid: OPENID, clientRequestId: requestId })
        .limit(1)
        .get()
      if (duplicate.data.length) {
        return { ok: true, data: publicFootprint(duplicate.data[0]) }
      }

      const id = validId(input.id) || idFromRequest(OPENID, requestId)
      const conflict = await footprints.where({ _id: id }).limit(1).get()
      if (conflict.data.length) {
        const existing = conflict.data[0]
        if (existing._openid === OPENID && existing.clientRequestId === requestId) {
          return { ok: true, data: publicFootprint(existing) }
        }
        throw new Error('足迹已存在，不能覆盖')
      }

      const data = sanitizeFootprint(input, OPENID)
      await footprints.doc(id).set({ data })
      return { ok: true, data: publicFootprint(data, id) }
    }

    if (action === 'update') {
      const id = validId(event.footprint && event.footprint.id)
      if (!id) throw new Error('足迹 ID 不能为空')
      const existing = await ownedFootprint(id, OPENID)
      if (existing.status === 'wishlist' && event.footprint.status !== 'wishlist') {
        throw new Error('请通过愿望实现流程记录到访')
      }
      if (existing.status === 'fulfilled' && event.footprint.status !== 'fulfilled') {
        throw new Error('已实现愿望不能直接改为其他状态')
      }
      const input = { ...event.footprint }
      if (existing.status === 'fulfilled') {
        input.fulfilledAt = existing.fulfilledAt
        input.fulfilledVisitId = existing.fulfilledVisitId
      }
      if (existing.wishId) input.wishId = existing.wishId
      const data = sanitizeFootprint(input, OPENID, existing)
      await footprints.doc(id).set({ data })
      const removedPhotos = (existing.photos || []).filter(
        (path) => !(data.photos || []).includes(path),
      )
      if (removedPhotos.length) await deleteCloudFiles(removedPhotos, OPENID)
      return { ok: true, data: publicFootprint(data, id) }
    }

    if (action === 'fulfillWishlist') {
      const wishId = validId(event.id)
      if (!wishId) throw new Error('愿望 ID 不能为空')
      const wish = await ownedFootprint(wishId, OPENID)
      const visitId = idFromRequest(OPENID, `fulfill:${wishId}`)
      if (wish.status === 'fulfilled') {
        const visit = await ownedFootprint(wish.fulfilledVisitId || visitId, OPENID)
        return { ok: true, data: { wish: publicFootprint(wish, wishId), visit: publicFootprint(visit, visitId) } }
      }
      if (wish.status !== 'wishlist') throw new Error('只有想去地点可以实现愿望')
      const input = event.visit || {}
      const visitData = sanitizeFootprint({
        ...input,
        status: 'visited',
        poiName: wish.poiName,
        placeId: wish.placeId || input.placeId,
        wishId,
        wishlistCreatedAt: wish.wishlistCreatedAt || wish.createdAt,
        clientRequestId: `fulfill:${wishId}`,
      }, OPENID)
      const prior = await footprints.where({ _id: visitId }).limit(1).get()
      if (!prior.data.length) await footprints.doc(visitId).set({ data: visitData })
      else if (prior.data[0]._openid !== OPENID || prior.data[0].wishId !== wishId) throw new Error('到访记录冲突')
      const savedVisit = prior.data[0] || visitData
      const fulfilledAt = Date.now()
      const wishData = sanitizeFootprint({
        ...wish,
        status: 'fulfilled',
        fulfilledAt,
        fulfilledVisitId: visitId,
      }, OPENID, wish)
      await footprints.doc(wishId).set({ data: wishData })
      return {
        ok: true,
        data: { wish: publicFootprint(wishData, wishId), visit: publicFootprint(savedVisit, visitId) },
      }
    }

    if (action === 'delete') {
      const id = validId(event.id)
      if (!id) throw new Error('足迹 ID 不能为空')
      const existing = await ownedFootprint(id, OPENID)
      if (existing.status === 'visited' && existing.wishId) {
        const linked = await footprints.where({ _id: existing.wishId, _openid: OPENID }).limit(1).get()
        const wish = linked.data[0]
        if (wish && wish.status === 'fulfilled' && wish.fulfilledVisitId === id) {
          const resetWish = sanitizeFootprint({ ...wish, status: 'wishlist', fulfilledAt: undefined, fulfilledVisitId: undefined }, OPENID, wish)
          await footprints.doc(existing.wishId).set({ data: resetWish })
        }
      }
      if (existing.status === 'fulfilled' && existing.fulfilledVisitId) {
        const linked = await footprints.where({ _id: existing.fulfilledVisitId, _openid: OPENID }).limit(1).get()
        const visit = linked.data[0]
        if (visit && visit.wishId === id) {
          const detachedVisit = sanitizeFootprint({
            ...visit,
            wishId: undefined,
            wishlistCreatedAt: undefined,
            convertedFromWishlist: false,
          }, OPENID, visit)
          await footprints.doc(existing.fulfilledVisitId).set({ data: detachedVisit })
        }
      }
      await footprints.doc(id).remove()
      if (existing.photos && existing.photos.length) {
        await deleteCloudFiles(existing.photos, OPENID)
      }
      return { ok: true, data: null }
    }

    throw new Error('不支持的操作')
  } catch (error) {
    return { ok: false, message: error.message || '足迹操作失败' }
  }
}
