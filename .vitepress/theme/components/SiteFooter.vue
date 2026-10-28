<script setup lang="ts">
import SiteLinks from './SiteLinks.vue'

defineProps<{ links?: boolean }>()

const year = new Date().getFullYear()
</script>

<template>
	<footer class="site-footer">
		<SiteLinks v-if="links" />
		<p>© {{ year }} Jo Turk · <a href="/feed.xml">rss</a></p>
	</footer>
</template>

<style scoped>
.site-footer {
	display: flex;
	flex-direction: column;
	gap: 8px;
	color: var(--muted);
	font-size: 0.875rem;
}

p {
	margin: 0;
}
</style>
