const MAX_PAGE_SIZE = 100

const parsePageLimit = (value) => {
  if (value === undefined) return MAX_PAGE_SIZE
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new Error('分页数量不合法')
  }
  return value
}

const encodeCursor = (row) => Buffer.from(JSON.stringify([row.updatedAt, row._id]))
  .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const parseCursor = (value) => {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('分页游标不合法')
  }
  try {
    const decoded = Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    const [updatedAt, id] = JSON.parse(decoded)
    if (!Number.isFinite(updatedAt) || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) {
      throw new Error('invalid cursor')
    }
    return { updatedAt, id }
  } catch {
    throw new Error('分页游标不合法')
  }
}

const pageFromRows = (rows, limit, map) => {
  const items = rows.slice(0, limit)
  return {
    items: items.map(map),
    nextCursor: rows.length > limit ? encodeCursor(items[items.length - 1]) : null,
    hasMore: rows.length > limit,
  }
}

module.exports = { MAX_PAGE_SIZE, parsePageLimit, parseCursor, pageFromRows }
