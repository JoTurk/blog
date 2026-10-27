import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { Feed } from 'feed'
import { createContentLoader, defineConfig } from 'vitepress'

const hostname = 'https://joturk.net'
const title = 'Jo Turk'
const description = 'Personal blog'
const license = 'https://creativecommons.org/licenses/by/4.0/'
const feedPath = '/feed.xml'

export default defineConfig({
	title,
	description,
	lang: 'en',
	cleanUrls: true,
	lastUpdated: true,
	sitemap: { hostname },
	markdown: { theme: 'rose-pine-moon' },
	head: [
		['link', { rel: 'license', href: license }],
		[
			'link',
			{
				rel: 'alternate',
				type: 'application/rss+xml',
				title,
				href: feedPath,
			},
		],
	],

	async buildEnd(config) {
		const feed = new Feed({
			title,
			description,
			id: hostname,
			link: hostname,
			language: 'en',
			copyright: `© ${new Date().getFullYear()} Jo Turk, licensed under CC BY 4.0: ${license}`,
			feedLinks: { rss: `${hostname}${feedPath}` },
		})

		const posts = await createContentLoader('posts/*.md', {
			excerpt: true,
			render: true,
		}).load()

		posts
			.filter((post) => !post.frontmatter.draft)
			.sort(
				(a, b) => +new Date(b.frontmatter.date) - +new Date(a.frontmatter.date),
			)
			.forEach(({ url, frontmatter, excerpt, html }) => {
				feed.addItem({
					title: frontmatter.title,
					id: `${hostname}${url}`,
					link: `${hostname}${url}`,
					description: excerpt?.replaceAll('&ZeroWidthSpace;', ''),
					content: html?.replaceAll('&ZeroWidthSpace;', ''),
					date: new Date(frontmatter.date),
				})
			})

		writeFileSync(path.join(config.outDir, feedPath), feed.rss2())
	},
})
