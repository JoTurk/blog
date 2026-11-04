export type Bytes = Uint8Array<ArrayBuffer>

export function hexList(bytes: ArrayLike<number>): string[] {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
}

export function hex(bytes: ArrayLike<number>, sep = ' '): string {
	return hexList(bytes).join(sep)
}

export function random(n: number): Bytes {
	return crypto.getRandomValues(new Uint8Array(n))
}

export function utf8(text: string): Bytes {
	return new TextEncoder().encode(text) as Bytes
}

export function concat(...parts: Uint8Array[]): Bytes {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
	let at = 0
	for (const p of parts) {
		out.set(p, at)
		at += p.length
	}
	return out
}

export async function sha256(data: Uint8Array): Promise<Bytes> {
	return new Uint8Array(
		await crypto.subtle.digest('SHA-256', data as Bytes),
	) as Bytes
}

async function hmac(key: Uint8Array, data: Uint8Array): Promise<Bytes> {
	const k = await crypto.subtle.importKey(
		'raw',
		key as Bytes,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	)
	return new Uint8Array(
		await crypto.subtle.sign('HMAC', k, data as Bytes),
	) as Bytes
}

export function hkdfExtract(salt: Uint8Array, ikm: Uint8Array) {
	return hmac(salt.length ? salt : new Uint8Array(32), ikm)
}

export async function hkdfExpand(
	prk: Uint8Array,
	info: Uint8Array,
	length: number,
): Promise<Bytes> {
	const out = new Uint8Array(length)
	let prev: Uint8Array = new Uint8Array(0)
	for (let at = 0, i = 1; at < length; i++) {
		prev = await hmac(prk, concat(prev, info, new Uint8Array([i])))
		out.set(prev.subarray(0, length - at), at)
		at += prev.length
	}
	return out
}

export function hkdfExpandLabel(
	secret: Uint8Array,
	label: string,
	context: Uint8Array,
	length: number,
) {
	const full = utf8(`dtls13${label}`)
	const info = concat(
		new Uint8Array([length >> 8, length & 0xff, full.length]),
		full,
		new Uint8Array([context.length]),
		context,
	)
	return hkdfExpand(secret, info, length)
}

export async function aesEcbBlock(
	key: Uint8Array,
	block: Uint8Array,
): Promise<Bytes> {
	const k = await crypto.subtle.importKey(
		'raw',
		key as Bytes,
		'AES-CBC',
		false,
		['encrypt'],
	)
	const out = await crypto.subtle.encrypt(
		{ name: 'AES-CBC', iv: new Uint8Array(16) },
		k,
		block.subarray(0, 16) as Bytes,
	)
	return new Uint8Array(out, 0, 16) as Bytes
}

export async function aesGcm(
	mode: 'encrypt' | 'decrypt',
	key: Uint8Array,
	iv: Uint8Array,
	data: Uint8Array,
	aad: Uint8Array = new Uint8Array(0),
): Promise<Bytes> {
	const k = await crypto.subtle.importKey(
		'raw',
		key as Bytes,
		'AES-GCM',
		false,
		[mode],
	)
	const params = {
		name: 'AES-GCM',
		iv: iv as Bytes,
		additionalData: aad as Bytes,
	}
	const out =
		mode === 'encrypt'
			? await crypto.subtle.encrypt(params, k, data as Bytes)
			: await crypto.subtle.decrypt(params, k, data as Bytes)
	return new Uint8Array(out) as Bytes
}
