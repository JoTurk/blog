export function formatDate(
	date: string,
	options: Intl.DateTimeFormatOptions,
): string {
	return new Date(date).toLocaleDateString('en-US', {
		...options,
		timeZone: 'UTC',
	})
}
