import type { MapSettings } from '../domain/types'

export const MOOD_OPTIONS: Array<{ value: string; label: string; emoji: string }> = [
  { value: 'happy', label: '开心', emoji: '😊' },
  { value: 'calm', label: '平静', emoji: '😌' },
  { value: 'excited', label: '兴奋', emoji: '🤩' },
  { value: 'grateful', label: '感恩', emoji: '🥰' },
  { value: 'nostalgic', label: '怀念', emoji: '🥹' },
  { value: 'relaxed', label: '放松', emoji: '😴' },
  { value: 'curious', label: '好奇', emoji: '🤔' },
  { value: 'romantic', label: '浪漫', emoji: '❤️' },
  { value: 'energetic', label: '活力', emoji: '💪' },
  { value: 'cozy', label: '温馨', emoji: '🏠' },
]

export const CATEGORY_OPTIONS: Array<{ value: string; label: string; emoji: string }> = [
  { value: 'park', label: '公园', emoji: '🌳' },
  { value: 'food', label: '美食', emoji: '🍜' },
  { value: 'scenic', label: '景点', emoji: '🏛️' },
  { value: 'shopping', label: '商场', emoji: '🛍️' },
  { value: 'bar', label: '酒吧', emoji: '🍸' },
  { value: 'nature', label: '自然', emoji: '🏔️' },
  { value: 'heritage', label: '古迹', emoji: '🏯' },
  { value: 'market', label: '市集', emoji: '🎪' },
  { value: 'sports', label: '运动', emoji: '⚽' },
  { value: 'exhibition', label: '展览', emoji: '🎨' },
  { value: 'show', label: '演出', emoji: '🎭' },
  { value: 'home', label: '日常', emoji: '🏠' },
]

export const MARKER_COLORS: Array<{ value: string; label: string; color: string }> = [
  { value: '#5B6CFF', label: '启程蓝紫', color: '#5B6CFF' },
  { value: '#FF8F84', label: '探索橙粉', color: '#FF8F84' },
  { value: '#42C8DF', label: '发现青蓝', color: '#42C8DF' },
  { value: '#F4B93F', label: '高光金黄', color: '#F4B93F' },
  { value: '#F16FA8', label: '陪伴粉', color: '#F16FA8' },
  { value: '#F39A79', label: '晨曦暖色', color: '#F39A79' },
]

export const MARKER_EMOJIS: string[] = [
  '📍', '🌟', '☕', '🌸', '🌊', '🏔️', '🍜', '🌳', '🏛️', '🎭',
  '❤️', '🏠', '✨', '🍂', '🌈', '🎡', '🍦', '🍷', '📚', '🎵',
]

export const moodLabel = (value?: string): string =>
  MOOD_OPTIONS.find((m) => m.value === value)?.label || ''

export const moodEmoji = (value?: string): string =>
  MOOD_OPTIONS.find((m) => m.value === value)?.emoji || ''

export const categoryLabel = (value?: string): string =>
  CATEGORY_OPTIONS.find((c) => c.value === value)?.label || ''

export const categoryEmoji = (value?: string): string =>
  CATEGORY_OPTIONS.find((c) => c.value === value)?.emoji || ''

export const DEFAULT_MAP_SETTINGS: MapSettings = {
  markerStyle: 'dot',
  theme: 'clean',
  clusterEnabled: true,
}
