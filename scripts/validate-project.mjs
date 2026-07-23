import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const miniprogram = path.join(root, 'miniprogram')
const errors = []

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

for (const asset of ['paper-texture.jpg', 'coconut-latte.jpg', 'milk-tea.jpg']) {
  const file = path.join(miniprogram, 'assets', asset)
  if (!fs.existsSync(file)) errors.push(`缺少视觉资源：${path.relative(root, file)}`)
}

for (const name of ['login', 'recordMutation', 'wheelMutation', 'accountMutation', 'seedCatalog']) {
  for (const fileName of ['index.js', 'package.json']) {
    const file = path.join(root, 'cloudfunctions', name, fileName)
    if (!fs.existsSync(file)) errors.push(`缺少云函数文件：${path.relative(root, file)}`)
  }
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}

console.log(`项目结构检查通过：${appJson.pages.length} 个页面、5 个云函数、3 个视觉资源`)
