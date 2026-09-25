import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const miniprogram = path.join(root, 'miniprogram')
const errors = []
const maxMediaBytes = 200 * 1024
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

const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    errors.push(`${path.relative(root, file)}: ${error.message}`)
    return null
  }
}

const appJson = readJson(path.join(miniprogram, 'app.json'))
readJson(path.join(root, 'project.config.json'))
readJson(path.join(miniprogram, 'sitemap.json'))

for (const page of appJson?.pages || []) {
  for (const extension of ['ts', 'json', 'wxml', 'wxss']) {
    const file = path.join(miniprogram, `${page}.${extension}`)
    if (!fs.existsSync(file)) errors.push(`缺少页面文件：${path.relative(root, file)}`)
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
    `代码包图片和音频资源总量不得超过 200 KB：当前 ${Math.ceil(totalMediaBytes / 1024)} KB`,
  )
}

const requiredCloudFunctions = [
  'login',
  'footprintMutation',
  'accountMutation',
  'aiAssistant',
  'travelPlanMutation',
  'timeCapsuleMutation',
  'sendCapsuleReminder',
  'shareCode',
]

for (const name of requiredCloudFunctions) {
  for (const fileName of ['index.js', 'package.json']) {
    const file = path.join(root, 'cloudfunctions', name, fileName)
    if (!fs.existsSync(file)) errors.push(`缺少云函数文件：${path.relative(root, file)}`)
  }
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log(
  `项目结构检查通过：${appJson.pages.length} 个页面、${requiredCloudFunctions.length} 个云函数、媒体总量 ${Math.ceil(totalMediaBytes / 1024)} KB`,
)
