<template>
	<nav class="site-nav" aria-label="Main">
		<a class="home" href="/">
			<img class="avatar" src="https://avatars.githubusercontent.com/u/7750446" alt="" width="36" height="36" />
			<span>jo turk</span>
		</a>
		<a href="/">← all posts</a>
	</nav>
</template>

<style scoped>
.site-nav {
	display: flex;
	flex-wrap: wrap;
	justify-content: space-between;
	align-items: center;
	gap: 12px;
	font-size: 0.9375rem;
	line-height: 1.4;
}

.site-nav a {
	padding: 10px 0;
}

.home {
	display: flex;
	align-items: center;
	gap: 10px;
	min-height: 44px;
	text-decoration: none;
	font-weight: 700;
}

.avatar {
	width: 36px;
	height: 36px;
	object-fit: cover;
}
</style>
