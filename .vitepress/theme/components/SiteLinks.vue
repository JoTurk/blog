<script setup lang="ts">
import { profile } from '../../profile'
</script>

<template>
	<nav class="links" aria-label="Links">
		<a v-for="link in profile.links" :key="link.label" :href="link.url">{{ link.label }}</a>
	</nav>
</template>

<style scoped>
.links {
	display: flex;
	flex-wrap: wrap;
	gap: 0 20px;
	font-size: 0.9375rem;
}

.links a {
	padding: 8px 0;
}
</style>
