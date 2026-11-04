import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { Feed } from 'feed'
import { createContentLoader, defineConfig, type HeadConfig } from 'vitepress'

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
	srcExclude: ['notes/**'],
	lastUpdated: true,
	sitemap: { hostname },
	markdown: {
		theme: 'rose-pine-moon',
		emoji: { shortcuts: {} },
		anchor: {
			permalink(slug, _options, state, index) {
				const heading = state.tokens[index + 1]
				const open = new state.Token('link_open', 'a', 1)
				open.attrSet('class', 'header-anchor')
				open.attrSet('href', `#${slug}`)
				const close = new state.Token('link_close', 'a', -1)
				const children = heading.children ?? []
				if (children.some((token) => token.type === 'link_open')) {
					const label = new state.Token('text', '', 0)
					label.content = ' #'
					open.attrSet('aria-label', `Permalink to ${heading.content}`)
					children.push(open, label, close)
				} else {
					children.unshift(open)
					children.push(close)
				}
				heading.children = children
			},
		},
	},
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

	transformHead({ pageData }) {
		const { image, imageAlt, date } = pageData.frontmatter
		if (!image) return
		const url = `${hostname}/${pageData.relativePath.replace(/(index)?\.md$/, '')}`
		const imageUrl = `${hostname}${image}`
		const pageDescription = pageData.description || description
		return [
			['meta', { property: 'og:type', content: 'article' }],
			['meta', { property: 'og:site_name', content: title }],
			['meta', { property: 'og:title', content: pageData.title }],
			['meta', { property: 'og:description', content: pageDescription }],
			['meta', { property: 'og:url', content: url }],
			['meta', { property: 'og:image', content: imageUrl }],
			['meta', { property: 'og:image:width', content: '1200' }],
			['meta', { property: 'og:image:height', content: '630' }],
			['meta', { property: 'og:image:alt', content: imageAlt ?? '' }],
			...(date
				? ([
						[
							'meta',
							{
								property: 'article:published_time',
								content: new Date(date).toISOString(),
							},
						],
					] satisfies HeadConfig[])
				: []),
			['meta', { name: 'twitter:card', content: 'summary_large_image' }],
			['meta', { name: 'twitter:image', content: imageUrl }],
			['meta', { name: 'twitter:image:alt', content: imageAlt ?? '' }],
		]
	},

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
