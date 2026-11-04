<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
	type AnimationName,
	animations,
	type CharacterName,
	characters,
	compose,
	height,
	lost,
	type Slot,
	width,
} from './characters'

const props = withDefaults(
	defineProps<{
		character?: CharacterName
		animation?: AnimationName
		frame?: number
		gone?: boolean
		size?: number
		flip?: boolean
		label?: string
	}>(),
	{
		character: 'client',
		animation: 'idle',
		gone: false,
		size: 96,
		flip: false,
	},
)

const cache = new Map<string, [string, string][]>()

function paths(character: CharacterName, animation: AnimationName, n: number) {
	const key = `${character}/${animation}/${n}`
	const hit = cache.get(key)
	if (hit) return hit
	const bySlot = new Map<string, string>()
	compose(character, animations[animation].frames[n]).forEach((row, y) => {
		let x = 0
		while (x < row.length) {
			const slot = row[x]
			let end = x + 1
			while (row[end] === slot) end++
			if (slot !== '.') {
				const run = end - x
				bySlot.set(
					slot,
					`${bySlot.get(slot) ?? ''}M${x} ${y}h${run}v1h-${run}z`,
				)
			}
			x = end
		}
	})
	const result = [...bySlot]
	cache.set(key, result)
	return result
}

const palette = computed(() =>
	props.gone ? lost : characters[props.character].palette,
)

const current = ref(props.frame ?? 0)
const reducedMotion = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

function start() {
	clearInterval(timer)
	const { fps, frames } = animations[props.animation]
	if (props.frame !== undefined) {
		current.value = props.frame % frames.length
		return
	}
	current.value = 0
	if (reducedMotion.value || frames.length < 2) return
	timer = setInterval(() => {
		current.value = (current.value + 1) % frames.length
	}, 1000 / fps)
}

let motionQuery: MediaQueryList | undefined

function onMotionChange() {
	reducedMotion.value = motionQuery?.matches ?? false
	start()
}

onMounted(() => {
	motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
	motionQuery.addEventListener('change', onMotionChange)
	onMotionChange()
})

onBeforeUnmount(() => {
	clearInterval(timer)
	motionQuery?.removeEventListener('change', onMotionChange)
})

watch(() => [props.animation, props.frame], start)

const shapes = computed(() => {
	const { frames } = animations[props.animation]
	return paths(props.character, props.animation, current.value % frames.length)
})
</script>

<template>
	<svg
		class="pixel-sprite"
		:class="{ flip }"
		:viewBox="`0 0 ${width} ${height}`"
		:width="size"
		:height="(size * height) / width"
		shape-rendering="crispEdges"
		:role="label ? 'img' : undefined"
		:aria-label="label"
		:aria-hidden="label ? undefined : 'true'"
	>
		<path
			v-for="[slot, d] of shapes"
			:key="slot"
			:d="d"
			:fill="palette[slot as Slot]"
		/>
	</svg>
</template>

<style scoped>
.pixel-sprite {
	display: inline-block;
	vertical-align: middle;
}

.flip {
	transform: scaleX(-1);
}
</style>
