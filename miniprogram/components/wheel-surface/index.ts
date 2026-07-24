import { getCanvasSetupStatus } from '../../utils/wheel'

interface Canvas2DLike {
  scale(x: number, y: number): void
}

interface CanvasLike {
  width: number
  height: number
  getContext(type: '2d'): Canvas2DLike
  requestAnimationFrame?(callback: (time: number) => void): number
}

interface CanvasHost {
  canvas: CanvasLike | null
  canvasSize: number
}

const getCanvasHost = (instance: unknown): CanvasHost => instance as CanvasHost

Component({
  properties: {
    canvasLabel: {
      type: String,
      value: '饮品选择转盘',
    },
  },
  lifetimes: {
    ready() {
      this.initializeCanvas()
    },
    detached() {
      const host = getCanvasHost(this)
      host.canvas = null
      host.canvasSize = 0
    },
  },
  methods: {
    initializeCanvas(attempt = 0) {
      this.createSelectorQuery()
        .select('#wheelCanvas')
        .fields({ node: true, size: true })
        .exec((result) => {
          const item = result[0] as { node?: CanvasLike; width?: number; height?: number }
          const status = getCanvasSetupStatus(Boolean(item?.node), item?.width || 0, attempt)
          if (status === 'retry') {
            setTimeout(() => this.initializeCanvas(attempt + 1), 32)
            return
          }
          if (status === 'failed' || !item.node || !item.width) return

          const canvas = item.node
          const ratio = wx.getWindowInfo().pixelRatio
          canvas.width = item.width * ratio
          canvas.height = (item.height || item.width) * ratio
          canvas.getContext('2d').scale(ratio, ratio)

          const host = getCanvasHost(this)
          host.canvas = canvas
          host.canvasSize = item.width
          this.triggerEvent('ready')
        })
    },
    refresh() {
      this.initializeCanvas()
    },
    getCanvasState() {
      const host = getCanvasHost(this)
      return {
        canvas: host.canvas,
        size: host.canvasSize,
      }
    },
  },
})
