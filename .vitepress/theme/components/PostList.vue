<script setup lang="ts">
import { computed } from 'vue'
import { data as posts } from '../../../posts/posts.data'
import { formatDate } from '../date'

const years = computed(() => {
	const groups = new Map<number, typeof posts>()
	for (const post of posts) {
		const year = new Date(post.date).getUTCFullYear()
		groups.set(year, [...(groups.get(year) ?? []), post])
	}
	return [...groups]
})
</script>

<template>
	<section class="post-list" aria-labelledby="writing">
		<h2 id="writing">things i wrote</h2>
		<div v-for="[year, yearPosts] of years" :key="year" class="year">
			<h3>{{ year }}</h3>
			<a v-for="post of yearPosts" :key="post.url" class="row" :href="post.url">
				<span class="title">{{ post.title }}</span>
				<span class="leader" aria-hidden="true"></span>
				<time :datetime="post.date">{{
					formatDate(post.date, { month: 'short', day: '2-digit' })
				}}</time>
			</a>
		</div>
	</section>
</template>

<style scoped>
.post-list {
	display: flex;
	flex-direction: column;
	gap: 28px;
}

h2 {
	margin: 0;
	color: var(--muted);
	font-size: 0.9375rem;
	font-weight: 600;
}

.year {
	display: flex;
	flex-direction: column;
}

h3 {
	margin: 0 0 6px;
	color: var(--accent);
	font-size: 0.8125rem;
	font-weight: 700;
}

.row {
	display: flex;
	align-items: baseline;
	gap: 12px;
	padding: 10px 0;
	text-decoration: none;
}

.title {
	flex: 0 1 auto;
	font-size: 1.0625rem;
	font-weight: 600;
}

.leader {
	flex: 1 1 24px;
	min-width: 24px;
	border-bottom: 2px dotted var(--rule);
}

time {
	flex: 0 0 auto;
	color: var(--muted);
	font-size: 0.875rem;
	font-variant-numeric: tabular-nums;
}

.row:hover .title {
	color: var(--accent);
}

.row:hover .leader {
	border-color: var(--accent);
}
</style>
