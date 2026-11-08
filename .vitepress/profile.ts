export const profile = {
	name: 'Jo Turk',
	bio: "I'm Jo Turk (She / Her), I work with media, network-transports and real-time, and help maintain a few open-source libraries.",
	links: [
		{ label: 'github', url: 'https://github.com/JoTurk' },
		{ label: 'bluesky', url: 'https://bsky.app/profile/joturk.net' },
		{ label: 'linkedin', url: 'https://www.linkedin.com/in/joturk/' },
		{ label: 'email', url: 'mailto:jo@joturk.net' },
	],
}

export function renderProfile(
	hostname: string,
	posts: { title: string; url: string; date: string | Date }[],
) {
	const escapeMarkdown = (text: string) => text.replace(/[\\`*_[\]<>]/g, '\\$&')
	const latest = [...posts]
		.sort((a, b) => +new Date(b.date) - +new Date(a.date))
		.slice(0, 5)
	return [
		'# Hello 👋',
		'',
		profile.bio,
		'',
		[
			`[blog](${hostname})`,
			...profile.links.map(({ label, url }) => `[${label}](${url})`),
		].join(' · '),
		'',
		'## Latest writing',
		'',
		...latest.map(
			(post) =>
				`- [${escapeMarkdown(post.title)}](${new URL(post.url, hostname).href}) — ${new Date(post.date).toISOString().slice(0, 10)}`,
		),
		'',
	].join('\n')
}
