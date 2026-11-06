<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import DemoFrame from './DemoFrame.vue'
import {
	aesEcbBlock,
	aesGcm,
	type Bytes,
	hexList,
	random,
	utf8,
} from './dtlsCrypto'
import PixelSprite from './PixelSprite.vue'

const tab = ref<'12' | '13'>('13')

// DTLS 1.2
const fields12 = [
	{
		id: 'type',
		name: 'type',
		bytes: [0x17],
		value: '23 = application_data',
		about:
			'What kind of record this is. Sent in the clear, so anyone can tell data from handshake from alerts.',
	},
	{
		id: 'version',
		name: 'version',
		bytes: [0xfe, 0xfd],
		value: 'FEFD = DTLS 1.2',
		about:
			'DTLS versions count down: 1.0 is FEFF, 1.2 is FEFD. Every record repeats it.',
	},
	{
		id: 'epoch',
		name: 'epoch',
		bytes: [0x00, 0x01],
		value: '1',
		about:
			'Which set of keys protects this record. Goes up by one each time the keys change.',
	},
	{
		id: 'seq',
		name: 'sequence number',
		bytes: [0x00, 0x00, 0x00, 0x00, 0x00, 0x2a],
		value: '42',
		about:
			'48 bits, in the clear. Used to spot replays, and readable by anyone counting your packets.',
	},
	{
		id: 'length',
		name: 'length',
		bytes: [0x00, 0x1d],
		value: '29 bytes follow',
		about: 'How many bytes of (encrypted) payload come after the header.',
	},
]
const picked12 = ref('seq')
const picked12Field = computed(
	() => fields12.find((f) => f.id === picked12.value) ?? fields12[0],
)

// DTLS 1.3
const cid = ref(false)
const seq16 = ref(true)
const hasLength = ref(true)
const epoch = ref(3)
const seq = ref(42)
const mallory = ref(false)

const CID = [0x7a, 0x3f, 0x91, 0x0c]
const INNER = [...utf8('hello'), 0x17]
const TAG = 16
const recordLength = INNER.length + TAG

const flags = computed(
	() =>
		0b0010_0000 |
		(+cid.value << 4) |
		(+seq16.value << 3) |
		(+hasLength.value << 2) |
		(epoch.value & 0b11),
)

const seqBytes = computed(() =>
	seq16.value
		? [(seq.value >> 8) & 0xff, seq.value & 0xff]
		: [seq.value & 0xff],
)

const header13 = computed(() => [
	flags.value,
	...(cid.value ? CID : []),
	...seqBytes.value,
	...(hasLength.value ? [recordLength >> 8, recordLength & 0xff] : []),
])

const bits = computed(() => {
	const b = flags.value
	return [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (b >> i) & 1)
})

const bitInfo = [
	{ name: 'fix', about: 'fixed' },
	{ name: 'fix', about: 'fixed' },
	{ name: 'fix', about: 'fixed' },
	{ name: 'C', about: 'connection ID present' },
	{ name: 'S', about: 'sequence number is 16 bits (off: 8 bits)' },
	{ name: 'L', about: 'length field present' },
	{ name: 'E', about: 'epoch, high bit of the low two' },
	{ name: 'E', about: 'epoch, low bit' },
]

function toggleBit(i: number) {
	if (i === 3) cid.value = !cid.value
	if (i === 4) seq16.value = !seq16.value
	if (i === 5) hasLength.value = !hasLength.value
}

function bitPressed(i: number) {
	return [cid.value, seq16.value, hasLength.value][i - 3]
}

// Crypto
interface Sealed {
	seq: number
	cipher: Bytes
	mask: Bytes
	encSeq: number[]
}
let keys: { aead: Bytes; iv: Bytes; sn: Bytes } | undefined
const snKey = ref<Bytes>()
const record = ref<Sealed>()
const history = ref<{ seq: number; plain: string; enc: string }[]>([])
let token = 0

async function seal() {
	if (!keys) return
	const mine = ++token
	const header = new Uint8Array(header13.value)
	const nonce = keys.iv.slice()
	let n = seq.value
	for (let i = nonce.length - 1; n > 0; i--, n = Math.floor(n / 256)) {
		nonce[i] ^= n & 0xff
	}
	const cipher = await aesGcm(
		'encrypt',
		keys.aead,
		nonce,
		new Uint8Array(INNER),
		header,
	)
	const mask = await aesEcbBlock(keys.sn, cipher.subarray(0, 16))
	if (mine !== token) return
	const encSeq = seqBytes.value.map((b, i) => b ^ mask[i])
	record.value = { seq: seq.value, cipher, mask, encSeq }
	const last = history.value.at(-1)
	if (!last || last.seq !== seq.value) {
		history.value = [
			...history.value,
			{
				seq: seq.value,
				plain: hexList(seqBytes.value).join(' '),
				enc: hexList(encSeq).join(' '),
			},
		].slice(-6)
	}
}

onMounted(() => {
	keys = { aead: random(16), iv: random(12), sn: random(16) }
	snKey.value = keys.sn
	seal()
})

watch([cid, seq16, hasLength, epoch], () => {
	history.value = []
	seal()
})
watch(seq, seal)

function nextRecord() {
	seq.value++
}

function setEpoch(delta: number) {
	epoch.value = Math.min(9, Math.max(1, epoch.value + delta))
}

const headerParts = computed(() => {
	const shown = mallory.value && record.value ? record.value.encSeq : null
	const parts: {
		id: string
		name: string
		bytes: string[]
		hidden?: boolean
	}[] = [
		{
			id: 'flags',
			name: 'flags',
			bytes: hexList([flags.value]),
		},
	]
	if (cid.value)
		parts.push({
			id: 'cid',
			name: 'connection ID',
			bytes: hexList(CID),
		})
	parts.push({
		id: 'seq',
		name: shown ? 'seq (encrypted)' : 'seq',
		bytes: hexList(shown ?? seqBytes.value),
		hidden: !!shown,
	})
	if (hasLength.value)
		parts.push({
			id: 'len',
			name: 'length',
			bytes: hexList([recordLength >> 8, recordLength & 0xff]),
		})
	return parts
})

function notesFor(
	withCid: boolean,
	long: boolean,
	withLength: boolean,
	e: number,
) {
	const out: string[] = []
	if (withCid)
		out.push(
			'Connection ID: the server finds your session by this, not your IP and port, so it survives a network switch.',
		)
	out.push(
		long
			? 'Sequence number: only the low 16 bits are sent. The receiver rebuilds the full number from the ones it has seen.'
			: 'Sequence number: only the low 8 bits. Fine for slow streams, and saves a byte on every packet.',
	)
	if (!withLength)
		out.push(
			'No length: the record runs to the end of the datagram, so it has to be the last record in it.',
		)
	out.push(
		`Epoch ${e}: only the low two bits (${(e & 3).toString(2).padStart(2, '0')}) travel. ${e === 3 ? 'Epoch 3 is application data.' : e === 2 ? 'Epoch 2 is the encrypted handshake.' : e === 1 ? 'Epoch 1 is 0-RTT early data.' : 'Epoch 4 and up come after each KeyUpdate.'}`,
	)
	return out
}

const notes = computed(() =>
	notesFor(cid.value, seq16.value, hasLength.value, epoch.value),
)
const roomiest = notesFor(true, true, false, 4)

const malloryMood = computed(() =>
	history.value.length >= 3 ? 'sad' : 'sneak',
)

const payload = computed(() =>
	record.value ? hexList(record.value.cipher) : Array(recordLength).fill('··'),
)

function fmt(bytes: Uint8Array | undefined, n = 16) {
	return bytes ? hexList(bytes.subarray(0, n)).join(' ') : '…'
}
</script>

<template>
	<DemoFrame label="take a header apart">
		<template #tabs>
			<div class="demo-tabs" role="group" aria-label="DTLS version">
				<button :aria-pressed="tab === '12'" @click="tab = '12'">DTLS 1.2</button>
				<button :aria-pressed="tab === '13'" @click="tab = '13'">DTLS 1.3</button>
			</div>
		</template>

		<div v-if="tab === '12'" class="pane">
			<div class="fields">
				<button
					v-for="f of fields12"
					:key="f.id"
					class="field"
					:class="[f.id, { picked: picked12 === f.id }]"
					:aria-pressed="picked12 === f.id"
					@click="picked12 = f.id"
				>
					<span class="demo-bytes">
						<span v-for="(b, i) of hexList(f.bytes)" :key="i">{{
							b
						}}</span>
					</span>
					<span class="field-name">{{ f.name }}</span>
				</button>
			</div>
			<p class="explain">
				<strong>{{ picked12Field.name }}</strong>
				<span class="demo-mono value">{{ picked12Field.value }}</span>
				{{ picked12Field.about }}
			</p>
			<div class="meter">
				<div class="count"><strong>13</strong> bytes of header</div>
				<p class="demo-note">
					Every field is plain text. Mallory reads all of it, on every packet.
				</p>
			</div>
		</div>

		<div v-else class="pane">
			<div class="bits-wrap">
				<div class="bits" role="group" aria-label="First header byte, bit by bit">
					<template v-for="(bit, i) of bits" :key="i">
						<button
							v-if="i >= 3 && i <= 5"
							class="bit toggle"
							:class="{ on: bit }"
							:aria-pressed="bitPressed(i)"
							:aria-label="`${bitInfo[i].name}: ${bitInfo[i].about}`"
							:title="bitInfo[i].about"
							@click="toggleBit(i)"
						>
							<span class="bit-val">{{ bit }}</span>
							<span class="bit-name">{{ bitInfo[i].name }}</span>
						</button>
						<span
							v-else
							class="bit"
							:class="{ fixed: i < 3, epoch: i > 5 }"
							:title="bitInfo[i].about"
						>
							<span class="bit-val">{{ bit }}</span>
							<span class="bit-name">{{ bitInfo[i].name }}</span>
						</span>
					</template>
				</div>
				<div class="epoch-step">
					<span>epoch</span>
					<button
						class="demo-btn secondary step"
						aria-label="Previous epoch"
						:disabled="epoch <= 1"
						@click="setEpoch(-1)"
					>
						−
					</button>
					<output class="demo-mono" aria-live="polite">{{ epoch }}</output>
					<button
						class="demo-btn secondary step"
						aria-label="Next epoch"
						:disabled="epoch >= 9"
						@click="setEpoch(1)"
					>
						+
					</button>
				</div>
			</div>
			<p class="demo-note tap-hint">Tap C, S or L to flip them.</p>

			<div class="row-label">header</div>
			<div class="fields">
				<div
					v-for="p of headerParts"
					:key="p.id"
					class="field static"
					:class="[p.id, { hidden: p.hidden }]"
				>
					<span class="demo-bytes">
						<span v-for="(b, i) of p.bytes" :key="i">{{ b }}</span>
					</span>
					<span class="field-name">{{ p.name }}</span>
				</div>
			</div>

			<div class="row-label">
				encrypted payload <span class="muted">({{ recordLength }} bytes)</span>
			</div>
			<div class="demo-bytes payload" aria-label="Encrypted payload bytes">
				<span v-for="(b, i) of payload" :key="i">{{ b }}</span>
			</div>
			<p class="demo-note inner">
				inside the lock: <span class="demo-mono">"hello"</span>
				<span class="ct">17</span> ← the real content type (application_data)
				now hides here, not in the header
			</p>

			<div class="meter">
				<div class="count">
					header: <strong>{{ header13.length }}</strong>
					{{ header13.length === 1 ? 'byte' : 'bytes' }}
				</div>
				<div class="bars" aria-hidden="true">
					<div class="bar now" :style="{ width: `${(header13.length / 13) * 100}%` }">
						1.3
					</div>
					<div class="bar old">DTLS 1.2: 13 bytes</div>
				</div>
			</div>

			<div class="notes-wrap">
				<ul class="notes">
					<li v-for="n of notes" :key="n">{{ n }}</li>
				</ul>
				<ul class="notes ghost" aria-hidden="true">
					<li v-for="n of roomiest" :key="n">{{ n }}</li>
				</ul>
			</div>

			<div v-if="mallory" class="mallory">
				<div class="mallory-head">
					<PixelSprite character="mallory" :animation="malloryMood" :size="56" />
					<p>
						{{
							history.length >= 3
								? 'The real numbers count up. What she sees jumps around. She can’t line packets up.'
								: 'Mallory tries to count your packets by their sequence number.'
						}}
					</p>
				</div>
				<dl class="steps demo-mono">
					<dt>sn_key <span class="why">(random here)</span></dt>
					<dd>{{ fmt(snKey) }}</dd>
					<dt>ciphertext[0..16]</dt>
					<dd>{{ fmt(record?.cipher) }}</dd>
					<dt>mask = AES-ECB(sn_key, ↑)</dt>
					<dd>
						<span class="mask-hit">{{ fmt(record?.mask, seqBytes.length) }}</span>
						{{ record ? hexList(record.mask.subarray(seqBytes.length)).join(' ') : '' }}
					</dd>
					<dt>seq {{ seq }} XOR mask</dt>
					<dd>
						{{ hexList(seqBytes).join(' ') }} ⊕
						{{ fmt(record?.mask, seqBytes.length) }} =
						<strong class="demo-bad">{{
							record ? hexList(record.encSeq).join(' ') : '…'
						}}</strong>
					</dd>
				</dl>
				<table class="history">
					<caption class="visually-hidden">
						Real sequence numbers next to what Mallory sees
					</caption>
					<thead>
						<tr>
							<th scope="col">record</th>
							<th scope="col">real seq</th>
							<th scope="col">Mallory sees</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="h of history" :key="h.seq">
							<td>{{ h.seq }}</td>
							<td class="demo-ok">{{ h.plain }}</td>
							<td class="demo-bad">{{ h.enc }}</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>

		<template v-if="tab === '13'" #controls>
			<label>
				<input v-model="mallory" type="checkbox" />
				what Mallory sees
			</label>
			<button class="demo-btn" @click="nextRecord">next record</button>
		</template>
		<template #caption>
			<template v-if="tab === '12'">
				Tap a field to see what it does. All 13 bytes travel in the clear.
			</template>
			<template v-else>
				Flip the bits and watch the header shrink to 2 bytes. Then turn on
				“what Mallory sees” and press “next record” a few times. The
				encryption here is real AES, running in your browser.
			</template>
		</template>
	</DemoFrame>
</template>

<style scoped>
.pane {
	min-width: 0;
}

.fields {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}

.field {
	display: flex;
	flex-direction: column;
	gap: 4px;
	align-items: flex-start;
	padding: 6px 8px;
	border: 0;
	border-bottom: 1px solid var(--rule);
	border-radius: 0;
	background: transparent;
	color: var(--text);
	font: inherit;
	text-align: left;
}

button.field {
	cursor: pointer;
}

.field.picked {
	border-color: var(--accent);
	background: var(--bubble);
}

.field-name {
	color: var(--muted);
	font: 0.75rem var(--font-mono);
}

.field.picked .field-name {
	color: var(--bubbletext);
}

.field.cid .demo-bytes > * {
	color: var(--info);
}

.field.seq .demo-bytes > * {
	color: var(--tip);
}

.field.hidden {
	border-color: var(--danger);
}

.field.hidden .demo-bytes > * {
	color: var(--danger);
}

.explain {
	margin: 14px 0 0;
	font-size: 0.9375rem;
	line-height: 1.5;
}

.value {
	margin: 0 6px;
	color: var(--accent);
	font-size: 0.8125rem;
}

.bits-wrap {
	display: flex;
	flex-wrap: wrap;
	gap: 8px 16px;
	align-items: center;
}

.bits {
	display: flex;
	gap: 4px;
}

.bit {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	width: 36px;
	height: 44px;
	padding: 0;
	border: 0;
	border-bottom: 1px solid var(--rule);
	border-radius: 0;
	background: var(--bg);
	color: var(--text);
	font: 700 1rem / 1 var(--font-mono);
}

.bit-name {
	margin-top: 6px;
	color: var(--muted);
	font-size: 0.6875rem;
}

.bit.fixed {
	opacity: 0.55;
}

.bit.epoch {
	border-color: var(--warning);
}

.bit.toggle {
	border: 1px solid var(--rule);
	border-radius: 2px;
	cursor: pointer;
}

.bit.toggle.on {
	border-color: var(--accent);
	background: var(--bubble);
	color: var(--bubbletext);
}

.epoch-step {
	display: flex;
	gap: 8px;
	align-items: center;
	font-size: 0.875rem;
}

.epoch-step output {
	min-width: 2ch;
	text-align: center;
	font-size: 1rem;
}

.step {
	width: 34px;
	height: 34px;
	padding: 0;
	line-height: 1;
}

.tap-hint {
	margin: 6px 0 0;
}

.row-label {
	margin: 12px 0 6px;
	color: var(--muted);
	font: 0.75rem var(--font-mono);
}

.muted {
}

.payload > * {
	color: var(--muted);
	opacity: 0.8;
}

.inner {
	margin-top: 10px;
}

.ct {
	display: inline-block;
	padding: 0 4px;
	border-radius: 0;
	background: var(--bubble);
	color: var(--bubbletext);
}

.meter {
	margin-top: 12px;
}

.count {
	font-size: 0.9375rem;
}

.count strong {
	color: var(--accent);
	font: 700 1.5rem var(--font-mono);
}

.bars {
	display: grid;
	gap: 4px;
	margin-top: 8px;
	font: 0.75rem / 1 var(--font-mono);
}

.bar {
	padding: 5px 8px;
	border-radius: 0;
	white-space: nowrap;
}

.bar.now {
	border-left: 2px solid var(--accent);
	background: var(--bubble);
	color: var(--bubbletext);
}

.bar.old {
	border-left: 2px solid var(--rule);
	background: var(--code);
	color: var(--muted);
}

@media (prefers-reduced-motion: no-preference) {
	.bar.now {
		transition: width 0.3s ease;
	}
}

.notes {
	margin: 12px 0 0;
	padding-left: 18px;
	color: var(--muted);
	font-size: 0.875rem;
	line-height: 1.5;
}

.notes li + li {
	margin-top: 4px;
}

.notes-wrap {
	display: grid;
}

.notes-wrap > .notes {
	grid-area: 1 / 1;
}

.notes.ghost {
	visibility: hidden;
}

.mallory {
	margin-top: 16px;
	padding-top: 12px;
	border-top: 1px dashed var(--rule);
}

.mallory-head {
	display: flex;
	gap: 12px;
	align-items: center;
}

.mallory-head p {
	margin: 0;
	font-size: 0.9375rem;
	line-height: 1.5;
}

.steps {
	display: grid;
	grid-template-columns: auto 1fr;
	gap: 6px 14px;
	margin: 16px 0 0;
	font-size: 0.8125rem;
}

.steps dt {
	color: var(--muted);
}

.why {
	font-size: 0.75rem;
	opacity: 0.8;
}

.steps dd {
	margin: 0;
	overflow-wrap: anywhere;
}

.mask-hit {
	color: var(--warning);
	font-weight: 700;
}

.history {
	margin: 16px 0 0;
	border-collapse: collapse;
	font: 0.8125rem var(--font-mono);
}

.history th {
	padding: 4px 16px 4px 0;
	color: var(--muted);
	font-weight: 400;
	text-align: left;
}

.history td {
	padding: 3px 16px 3px 0;
}

.visually-hidden {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
}

@media (max-width: 520px) {
	.bit {
		width: 30px;
		height: 40px;
	}

	.steps {
		grid-template-columns: 1fr;
		gap: 2px;
	}

	.steps dd {
		margin-bottom: 8px;
	}
}
</style>
