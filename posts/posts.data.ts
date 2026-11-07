import { createContentLoader } from 'vitepress'
// Posts published elsewhere, linked from the list and older/newer nav.
import externalPosts from './external.json'

export interface Post {
	title: string
	url: string
	date: string
	excerpt: string | undefined
	external?: boolean
	hideNav?: boolean
}

declare const data: Post[]

export { data }

export default createContentLoader('posts/*.md', {
	excerpt: true,
	transform(raw): Post[] {
		return raw
			.filter(({ frontmatter }) => !frontmatter.draft)
			.map(({ url, frontmatter, excerpt }) => ({
				title: frontmatter.title,
				url,
				date: frontmatter.date,
				excerpt,
				hideNav: !!frontmatter.hideNav,
			}))
			.concat(
				externalPosts.map((post) => ({
					...post,
					excerpt: undefined,
					external: true,
				})),
			)
			.sort((a, b) => +new Date(b.date) - +new Date(a.date))
	},
})
