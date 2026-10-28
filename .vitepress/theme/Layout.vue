<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'
import { data as posts } from '../../posts/posts.data'
import HomeHeader from './components/HomeHeader.vue'
import PostHeader from './components/PostHeader.vue'
import PostList from './components/PostList.vue'
import PostNav from './components/PostNav.vue'
import SiteFooter from './components/SiteFooter.vue'
import SiteNav from './components/SiteNav.vue'

const { page, frontmatter } = useData()

const isHome = computed(() => frontmatter.value.layout === 'home')
const isPost = computed(() => page.value.relativePath.startsWith('posts/'))

const index = computed(() =>
	posts.findIndex((p) => `${p.url}.md` === `/${page.value.relativePath}`),
)
const post = computed(() => posts[index.value])
</script>

<template>
	<div class="page" :class="{ home: isHome }">
		<template v-if="isHome">
			<HomeHeader />
			<PostList />
		</template>
		<template v-else>
			<SiteNav />
			<main>
				<h1 v-if="page.isNotFound">404</h1>
				<article v-else-if="isPost">
					<PostHeader />
					<Content />
				</article>
				<Content v-else />
			</main>
			<PostNav
				v-if="isPost && post"
				:older="posts[index + 1]"
				:newer="posts[index - 1]"
			/>
		</template>
		<SiteFooter :links="!isHome" />
	</div>
</template>

<style scoped>
.page {
	display: flex;
	flex-direction: column;
	gap: 48px;
	max-width: 720px;
	margin: 0 auto;
	padding: 48px 16px 96px;
}

.page.home {
	gap: 56px;
	padding-top: 88px;
}
</style>
