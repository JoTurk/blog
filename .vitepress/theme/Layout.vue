<script setup lang="ts">
import { useData } from 'vitepress'

const { page } = useData()
</script>

<template>
	<main>
		<h1 v-if="page.isNotFound">404</h1>
		<Content v-else />
	</main>
</template>
