const Module = require('module')
const path = require('path')

const attackerOpenId = 'attacker-openid'
const victimId = 'victim-record'
const originalRecord = {
  _id: victimId,
  _openid: 'victim-openid',
  drinkName: '受害者原记录',
  category: 'coffee',
  consumedAt: 1,
  calorieSource: 'user',
  createdAt: 1,
  updatedAt: 1,
}
const recordsById = new Map([[victimId, originalRecord]])

const records = {
  where(query) {
    return {
      limit() {
        return {
          async get() {
            return {
              data: [...recordsById.values()].filter((record) => {
                if (query._id !== undefined) return record._id === query._id
                return (
                  record._openid === query._openid &&
                  record.clientRequestId === query.clientRequestId
                )
              }),
            }
          },
        }
      },
    }
  },
  doc(id) {
    return {
      async get() {
        return { data: recordsById.get(id) }
      },
      async set({ data }) {
        recordsById.set(id, { _id: id, ...data })
      },
      async remove() {
        recordsById.delete(id)
      },
    }
  },
  async add({ data }) {
    const id = `generated-${recordsById.size}`
    recordsById.set(id, { _id: id, ...data })
    return { _id: id }
  },
}

const cloudMock = {
  DYNAMIC_CURRENT_ENV: 'test',
  init() {},
  database() {
    return {
      collection(name) {
        if (name !== 'drink_records') throw new Error(`unexpected collection: ${name}`)
        return records
      },
    }
  },
  getWXContext() {
    return { OPENID: attackerOpenId }
  },
  async deleteFile() {},
}

const originalLoad = Module._load
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'wx-server-sdk') return cloudMock
  return originalLoad.call(this, request, parent, isMain)
}

const { main } = require(
  path.resolve(process.cwd(), 'cloudfunctions/recordMutation/index.js'),
)

main({
  action: 'create',
  record: {
    id: victimId,
    clientRequestId: 'attacker-request',
    category: 'coffee',
    drinkName: '攻击者覆盖后的记录',
    consumedAt: 2,
    calorieSource: 'user',
  },
})
  .then((result) => {
    const finalRecord = recordsById.get(victimId)
    const rejected = result.ok === false
    const ownerPreserved = finalRecord._openid === originalRecord._openid
    const contentPreserved = finalRecord.drinkName === originalRecord.drinkName

    if (!rejected || !ownerPreserved || !contentPreserved) {
      throw new Error(
        `foreign record was overwritten: ${JSON.stringify({ result, finalRecord })}`,
      )
    }
  })
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
