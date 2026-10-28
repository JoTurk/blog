<script setup lang="ts">
import type { Post } from '../../../posts/posts.data'

defineProps<{ older?: Post; newer?: Post }>()
</script>

<template>
	<nav class="post-nav" aria-label="More posts">
		<a v-if="older" :href="older.url">
			<span class="label">← older</span>
			<span class="title">{{ older.title }}</span>
		</a>
		<div v-else>
			<span class="label">← older</span>
			<span class="title none">this is the first one</span>
		</div>
		<a v-if="newer" class="right" :href="newer.url">
			<span class="label">newer →</span>
			<span class="title">{{ newer.title }}</span>
		</a>
		<div v-else class="right">
			<span class="label">newer →</span>
			<span class="title none">you're on the latest one</span>
		</div>
	</nav>
</template>

<style scoped>
.post-nav {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	gap: 16px;
	padding-top: 28px;
	border-top: 2px dotted var(--rule);
	font-size: 0.9375rem;
	line-height: 1.5;
}

.post-nav > * {
	display: flex;
	flex: 1 1 240px;
	flex-direction: column;
	gap: 4px;
	padding: 6px 0;
	text-decoration: none;
}

.right {
	align-items: flex-end;
	text-align: right;
}

.label {
	color: var(--accent);
	font-size: 0.8125rem;
	font-weight: 700;
}

.title {
	font-weight: 600;
}

a:hover .title {
	color: var(--accent);
}

.none {
	color: var(--muted);
}
</style>
