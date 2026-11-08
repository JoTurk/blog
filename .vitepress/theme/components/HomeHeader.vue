<script setup lang="ts">
import { profile } from '../../profile'
import SiteLinks from './SiteLinks.vue'
</script>

<template>
	<header class="home-header">
		<div class="hello">
			<img class="avatar" src="https://avatars.githubusercontent.com/u/7750446" alt="My github PFP!" width="80" height="80" />
		</div>
		<p class="intro">
			{{ profile.bio }}
		</p>
		<SiteLinks />
	</header>
</template>

<style scoped>
.home-header {
	display: flex;
	flex-direction: column;
	gap: 16px;
	font-size: 1rem;
	line-height: 1.6;
}

.hello {
	display: flex;
	align-items: flex-start;
	gap: 4px;
}

.avatar {
	width: 80px;
	height: 80px;
	object-fit: cover;
}

h1 {
	margin: 0;
	font-size: 1.875rem;
	line-height: 1.2;
}

.intro {
	margin: 0;
	color: var(--muted);
}

</style>
