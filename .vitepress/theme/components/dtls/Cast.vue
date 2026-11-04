<script setup lang="ts">
import type { AnimationName, CharacterName } from './characters'
import PixelSprite from './PixelSprite.vue'

const cast: {
	character: CharacterName
	animation: AnimationName
	name: string
	role: string
}[] = [
	{
		character: 'client',
		animation: 'wave',
		name: 'Client',
		role: 'wants to talk to the server, privately',
	},
	{
		character: 'server',
		animation: 'idle',
		name: 'Server',
		role: 'wants to know it is really talking to the client',
	},
	{
		character: 'mallory',
		animation: 'sneak',
		name: 'Mallory',
		role: 'sits on the wire, reads everything, changes what she can',
	},
]
</script>

<template>
	<ul class="cast">
		<li v-for="c of cast" :key="c.name">
			<PixelSprite
				:character="c.character"
				:animation="c.animation"
				:size="64"
			/>
			<div>
				<strong>{{ c.name }}</strong>
				<span>{{ c.role }}</span>
			</div>
		</li>
	</ul>
</template>

<style scoped>
.cast {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
	gap: 16px;
	margin: 28px 0;
	padding: 0;
	list-style: none;
}

.cast li {
	display: flex;
	gap: 12px;
	align-items: center;
	margin: 0;
}

.cast div {
	display: flex;
	flex-direction: column;
	line-height: 1.4;
}

.cast span {
	color: var(--muted);
	font-size: 0.875rem;
}
</style>
