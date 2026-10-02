import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const miniprogram = path.join(root, 'miniprogram')
const errors = []
const maxMediaBytes = 320 * 1024
const mediaExtensions = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.mp3',
  '.wav',
  '.aac',
  '.m4a',
  '.ogg',
])
let totalMediaBytes = 0
let growthDecodedBytes = 0
const maxGrowthDecodedBytes = 8 * 1024 * 1024

const readPngDimensions = (file) => {
  const header = Buffer.alloc(24)
  const fd = fs.openSync(file, 'r')
  try {
    if (fs.readSync(fd, header, 0, header.length, 0) !== header.length) return null
  } finally {
    fs.closeSync(fd)
  }
  const pngSignature = '89504e470d0a1a0a'
  if (header.subarray(0, 8).toString('hex') !== pngSignature) return null
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
}

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    errors.push(`${path.relative(root, file)}: ${error.message}`)
    return null
  }
}

const appJson = readJson(path.join(miniprogram, 'app.json'))
const cloudBaseConfig = readJson(path.join(root, 'cloudbaserc.json'))
const packageJson = readJson(path.join(root, 'package.json'))
readJson(path.join(root, 'project.config.json'))
readJson(path.join(miniprogram, 'sitemap.json'))

const requiredGrowthAssets = [
  'journey.png',
  'explore.png',
  'discover.png',
  'highlight.png',
  'companion.png',
  'dawn.png',
  'acc-thinking.png',
  'acc-depart.png',
  'acc-explore.png',
  'acc-collect.png',
  'acc-record.png',
  'acc-companion.png',
  'acc-reunion.png',
  'pose-dawn.png',
  'pose-seasons.png',
  'pose-distance.png',
  'pose-hometown.png',
  'pose-reunion.png',
  'pose-annual.png',
]

for (const fileName of requiredGrowthAssets) {
  const file = path.join(miniprogram, 'assets', 'growth', fileName)
  if (!fs.existsSync(file)) {
    errors.push(`缺少 IP 形象资源：${path.relative(root, file)}`)
    continue
  }
  const dimensions = readPngDimensions(file)
  if (!dimensions) {
    errors.push(`无法读取 IP 形象尺寸：${path.relative(root, file)}`)
    continue
  }
  const maxDimension = fileName.startsWith('pose-') ? 144 : 360
  if (dimensions.width > maxDimension || dimensions.height > maxDimension) {
    errors.push(
      `IP 形象像素过大：${path.relative(root, file)} 为 ${dimensions.width}x${dimensions.height}，上限 ${maxDimension}x${maxDimension}`,
    )
  }
  if (fs.statSync(file).size > 40 * 1024) {
    errors.push(`单张 IP 形象不得超过 40 KB：${path.relative(root, file)}`)
  }
  growthDecodedBytes += dimensions.width * dimensions.height * 4
}

if (growthDecodedBytes > maxGrowthDecodedBytes) {
  errors.push(
    `IP 形象总解码预算不得超过 8 MB：当前 ${Math.ceil(growthDecodedBytes / 1024 / 1024)} MB`,
  )
}

const appConfigSource = fs.readFileSync(path.join(miniprogram, 'services', 'config.ts'), 'utf8')
const appVersion = appConfigSource.match(/export const APP_VERSION = ['"]([^'"]+)['"]/)?.[1]
if (!appVersion) {
  errors.push('miniprogram/services/config.ts: 缺少 APP_VERSION')
} else if (appVersion !== packageJson?.version) {
  errors.push(`应用版本号不一致：APP_VERSION=${appVersion}，package.json=${packageJson?.version || '未设置'}`)
}

for (const page of appJson?.pages || []) {
  for (const extension of ['ts', 'json', 'wxml', 'wxss']) {
    const file = path.join(miniprogram, `${page}.${extension}`)
    if (!fs.existsSync(file)) errors.push(`缺少页面文件：${path.relative(root, file)}`)
  }
}

// 本地组件路径和静态资源路径在 TypeScript 检查中不可见；发布前显式验证，
// 避免模拟器缓存正常但真机分包缺文件。
const sourceFiles = []
const collectProjectFiles = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) collectProjectFiles(file)
    else sourceFiles.push(file)
  }
}
collectProjectFiles(miniprogram)

for (const jsonFile of sourceFiles.filter((file) => path.extname(file) === '.json')) {
  const config = readJson(jsonFile)
  for (const [name, reference] of Object.entries(config?.usingComponents || {})) {
    if (typeof reference !== 'string' || !reference.startsWith('/')) continue
    const base = path.join(miniprogram, reference.slice(1))
    if (!['.json', '.wxml', '.wxss'].every((extension) => fs.existsSync(base + extension))) {
      errors.push(`${path.relative(root, jsonFile)}: 组件 ${name} 指向不存在的路径 ${reference}`)
    }
  }
}

const staticAssetPattern = /['"(](\/assets\/[^'"\s){}?]+)(?:\?[^'"\s)]*)?['")]/g
for (const sourceFile of sourceFiles.filter((file) => ['.ts', '.wxml', '.wxss'].includes(path.extname(file)))) {
  const source = fs.readFileSync(sourceFile, 'utf8')
  let match
  while ((match = staticAssetPattern.exec(source))) {
    const asset = path.join(miniprogram, match[1].slice(1))
    if (!fs.existsSync(asset)) {
      errors.push(`${path.relative(root, sourceFile)}: 引用了不存在的资源 ${match[1]}`)
    }
  }
}

const visitMediaFiles = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      visitMediaFiles(file)
      continue
    }
    if (!mediaExtensions.has(path.extname(entry.name).toLowerCase())) continue
    const size = fs.statSync(file).size
    totalMediaBytes += size
  }
}

visitMediaFiles(miniprogram)

if (totalMediaBytes > maxMediaBytes) {
  errors.push(
    `代码包图片和音频资源总量不得超过 320 KB：当前 ${Math.ceil(totalMediaBytes / 1024)} KB`,
  )
}

const requiredCloudFunctions = [
  'login',
  'footprintMutation',
  'accountMutation',
  'travelPlanMutation',
  'timeCapsuleMutation',
  'sendCapsuleReminder',
  'sendMembershipReminder',
  'paymentMutation',
  'paymentNotify',
]

for (const name of requiredCloudFunctions) {
  if (!cloudBaseConfig?.functions?.some((entry) => entry.name === name)) {
    errors.push(`云函数未列入 cloudbaserc.json：${name}`)
  }
  for (const fileName of ['index.js', 'package.json', 'package-lock.json']) {
    const file = path.join(root, 'cloudfunctions', name, fileName)
    if (!fs.existsSync(file)) errors.push(`缺少云函数文件：${path.relative(root, file)}`)
  }
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log(
  `项目结构检查通过：${appJson.pages.length} 个页面、${requiredCloudFunctions.length} 个云函数、媒体总量 ${Math.ceil(totalMediaBytes / 1024)} KB、IP 解码预算 ${Math.ceil(growthDecodedBytes / 1024)} KB`,
)
