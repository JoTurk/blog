<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'
import { formatDate } from '../date'

const { frontmatter } = useData()

const tags = computed<string[]>(() => frontmatter.value.tags ?? [])
</script>

<template>
	<header class="post-header">
		<h1>{{ frontmatter.title }}</h1>
		<time v-if="frontmatter.date" :datetime="frontmatter.date">{{
			formatDate(frontmatter.date, {
				month: 'short',
				day: 'numeric',
				year: 'numeric',
			})
		}}</time>
		<p v-if="tags.length" class="tags">
			filed under
			<template v-for="(tag, i) of tags" :key="tag">
				<span class="tag">{{ tag }}</span><template v-if="i < tags.length - 1">, </template>
			</template>
		</p>
	</header>
</template>

<style scoped>
.post-header {
	display: flex;
	flex-direction: column;
	gap: 8px;
	margin-bottom: 28px;
}

h1 {
	margin: 0;
}

time,
.tags {
	margin: 0;
	color: var(--muted);
	font-size: 0.875rem;
}

.tag {
	color: var(--accent);
	font-weight: 600;
}
</style>
