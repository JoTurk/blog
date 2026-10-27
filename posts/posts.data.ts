import { createContentLoader } from 'vitepress'

export interface Post {
	title: string
	url: string
	date: string
	excerpt: string | undefined
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
			}))
			.sort((a, b) => +new Date(b.date) - +new Date(a.date))
	},
})
