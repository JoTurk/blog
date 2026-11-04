export type Slot = 'K' | 'H' | 'S' | 'O' | 'A' | 'W' | 'L' | 'P' | 'X' | 'G'
export type Palette = Record<Slot, string>

export const width = 24
export const height = 24

const parts = {
	'head.bob': [
		'....HHHHHHHH....',
		'..HHHHHHHHHHHH..',
		'.HHHHHHHHHHHHHH.',
		'HHHHHHHHHHHHHHHH',
		'HHHSHHHHHHHHSHHH',
		'HHSSSHHHHHHSSSHH',
		'HHSSSSSSSSSSSSHH',
		'HHSSSSSSSSSSSSHH',
		'HHSSSSSSSSSSSSHH',
		'HHSSSSSSSSSSSSHH',
		'HHSSSSSSSSSSSSHH',
		'HH.SSSSSSSSSS.HH',
	],
	'head.spiky': [
		'...H..H..H..H...',
		'..HHHHHHHHHHHH..',
		'.HHHHHHHHHHHHHH.',
		'HHHHHHHHHHHHHHHH',
		'HHHSHHHSSHHHSHHH',
		'HHSSSSSSSSSSSSHH',
		'.HSSSSSSSSSSSSH.',
		'.HSSSSSSSSSSSSH.',
		'.HSSSSSSSSSSSSH.',
		'..SSSSSSSSSSSS..',
		'..SSSSSSSSSSSS..',
		'...SSSSSSSSSS...',
	],
	'head.hood': [
		'.XX..........XX.',
		'.XXX........XXX.',
		'.XXXXXXXXXXXXXX.',
		'XXXXXXXXXXXXXXXX',
		'XXHHHHHHHHHHHHXX',
		'XXHSSHHHHHHSSHXX',
		'XXSSSSSSSSSSSSXX',
		'XXSSSSSSSSSSSSXX',
		'XXSSSSSSSSSSSSXX',
		'XXSSSSSSSSSSSSXX',
		'XXSSSSSSSSSSSSXX',
		'XXXSSSSSSSSSSXXX',
	],

	// Faces
	'face.smile': [
		'............',
		'.KK......KK.',
		'.KK......KK.',
		'....K..K....',
		'.....KK.....',
	],
	'face.blink': [
		'............',
		'............',
		'.KK......KK.',
		'....K..K....',
		'.....KK.....',
	],
	'face.wow': [
		'............',
		'.KK......KK.',
		'.KK......KK.',
		'.....KK.....',
		'.....KK.....',
	],
	'face.sad': [
		'............',
		'............',
		'.KK......KK.',
		'.....KK.....',
		'....K..K....',
	],
	'face.smirk': [
		'............',
		'.KKK....KKK.',
		'..K......K..',
		'......K.....',
		'...KKK......',
	],
	'face.joy': [
		'............',
		'.K.K....K.K.',
		'..K......K..',
		'....KKKK....',
		'.....KK.....',
	],
	'face.focus': [
		'............',
		'............',
		'.KK......KK.',
		'............',
		'.....KK.....',
	],

	body: ['OOOOOOOOOO', 'OOOOOOOOOO', 'OOOOOOOOOO', 'WWWWWWWWWW'],

	'legs.stand': ['.WWW..WWW.', '.PPP..PPP.'],
	'legs.stepL': ['WWW...WWW.', 'PPP...PP..'],
	'legs.stepR': ['.WWW...WWW', '..PP...PPP'],
	'legs.jump': ['.WW....WW.', 'PP......PP'],

	// Arms
	'arms.down': [
		'',
		'',
		'',
		'',
		'.AA..........AA.',
		'.AA..........AA.',
		'.AA..........AA.',
		'.SS..........SS.',
	],
	'arms.wave': [
		'..............SS',
		'..............SS',
		'.............AA.',
		'.............AA.',
		'.AA.........AA..',
		'.AA.............',
		'.AA.............',
		'.SS.............',
	],
	'arms.up': [
		'SS............SS',
		'SS............SS',
		'.AA..........AA.',
		'.AA..........AA.',
		'..AA........AA..',
	],
	'arms.throw': [
		'',
		'',
		'',
		'',
		'.AA.........AAAASS',
		'.AA.........AAAASS',
		'.AA...............',
		'.SS...............',
	],
	'arms.hold': [
		'',
		'',
		'',
		'',
		'.AA..........AA.',
		'.AAA........AAA.',
		'..AAASS..SSAAA..',
	],
	'arms.type1': [
		'',
		'',
		'',
		'',
		'.AA..........AA.',
		'.AAA........AAA.',
		'..AASS....SSAA..',
	],
	'arms.type2': [
		'',
		'',
		'',
		'',
		'.AA..........AA.',
		'.AAA........AAA.',
		'..AAASS..SSAA...',
	],

	'prop.packet': ['LLLLLL', 'LPLLPL', 'LLPPLL', 'LLLLLL'],
	'prop.laptop': [
		'.GGGGGGGGGG.',
		'.GGGGGGGGGG.',
		'.GGGGPGGGGG.',
		'GGGGGGGGGGGG',
	],
	'prop.z': ['LLL', '..L', '.L.', 'LLL'],
	'prop.headset': [
		'',
		'...XXXXXXXXXXXX...',
		'..X............X..',
		'.X..............X.',
		'.X..............X.',
		'XX..............XX',
		'XX..............XX',
		'XX..............XX',
		'.XXX..............',
		'...XX.............',
	],
} satisfies Record<string, string[]>

type Part = keyof typeof parts
type Placed = [part: Part, x: number, y: number]

interface Character {
	head: Part
	extras: Placed[]
	palette: Palette
}

export const characters = {
	client: {
		head: 'head.bob',
		extras: [],
		palette: {
			K: '#241619',
			H: '#53333b',
			S: '#f4d9ca',
			O: '#ff9cc4',
			A: '#e07aa6',
			W: '#f9f6f8',
			L: '#f9f6f8',
			P: '#b56f8e',
			X: '#ff9cc4',
			G: '#7f6c6b',
		},
	},
	server: {
		head: 'head.spiky',
		extras: [['prop.headset', -1, 0]],
		palette: {
			K: '#16141f',
			H: '#45406a',
			S: '#f4d9ca',
			O: '#a9b8ff',
			A: '#8c9cf0',
			W: '#e0def4',
			L: '#e0def4',
			P: '#6f7bbf',
			X: '#e0def4',
			G: '#6e6a86',
		},
	},
	mallory: {
		head: 'head.hood',
		extras: [],
		palette: {
			K: '#120d10',
			H: '#e8e0e6',
			S: '#d9c2c9',
			O: '#3a3142',
			A: '#4a3f55',
			W: '#2b2430',
			L: '#e8e0e6',
			P: '#ff8a8a',
			X: '#3a3142',
			G: '#6b5a66',
		},
	},
	jo: {
		head: 'head.bob',
		extras: [],
		palette: {
			K: '#241619',
			H: '#53333b',
			S: '#f4d9ca',
			O: '#f8731a',
			A: '#e97b5b',
			W: '#f9f6f8',
			L: '#f9f6f8',
			P: '#c69494',
			X: '#f8731a',
			G: '#8a7f9a',
		},
	},
} satisfies Record<string, Character>

export type CharacterName = keyof typeof characters

export const lost: Palette = {
	K: '#2a2428',
	H: '#4a3f46',
	S: '#6e6268',
	O: '#5a4e55',
	A: '#5a4e55',
	W: '#6e6268',
	L: '#6e6268',
	P: '#5a4e55',
	X: '#5a4e55',
	G: '#4a3f46',
}

interface Frame {
	dy: number
	face: Part
	arms: Part
	legs: Part
	props?: Placed[]
}

const f = (
	dy: number,
	face: string,
	arms: string,
	legs: string,
	props: Placed[] = [],
): Frame => ({
	dy,
	face: `face.${face}` as Part,
	arms: `arms.${arms}` as Part,
	legs: `legs.${legs}` as Part,
	props,
})

export const animations = {
	idle: {
		fps: 3,
		frames: [
			f(0, 'smile', 'down', 'stand'),
			f(0, 'smile', 'down', 'stand'),
			f(1, 'smile', 'down', 'stand'),
			f(0, 'blink', 'down', 'stand'),
		],
	},
	wave: {
		fps: 4,
		frames: [f(0, 'joy', 'wave', 'stand'), f(0, 'joy', 'down', 'stand')],
	},
	send: {
		fps: 4,
		frames: [
			f(0, 'smile', 'hold', 'stand', [['prop.packet', 9, 14]]),
			f(0, 'focus', 'wave', 'stand', [['prop.packet', 16, 6]]),
			f(0, 'joy', 'throw', 'stand'),
		],
	},
	walk: {
		fps: 6,
		frames: [
			f(0, 'smile', 'down', 'stepL'),
			f(1, 'smile', 'down', 'stand'),
			f(0, 'smile', 'down', 'stepR'),
			f(1, 'smile', 'down', 'stand'),
		],
	},
	yay: {
		fps: 5,
		frames: [f(0, 'joy', 'up', 'stand'), f(-2, 'joy', 'up', 'jump')],
	},
	wow: {
		fps: 5,
		frames: [f(-1, 'wow', 'up', 'jump'), f(0, 'wow', 'up', 'stand')],
	},
	sad: { fps: 1, frames: [f(1, 'sad', 'down', 'stand')] },
	sleep: {
		fps: 2,
		frames: [
			f(1, 'blink', 'down', 'stand', [['prop.z', 19, 1]]),
			f(1, 'blink', 'down', 'stand', [['prop.z', 20, 0]]),
		],
	},
	type: {
		fps: 6,
		frames: [
			f(0, 'focus', 'type1', 'stand', [['prop.laptop', 6, 14]]),
			f(0, 'focus', 'type2', 'stand', [['prop.laptop', 6, 14]]),
		],
	},
	sneak: {
		fps: 4,
		frames: [f(1, 'smirk', 'hold', 'stepL'), f(1, 'smirk', 'hold', 'stepR')],
	},
} satisfies Record<string, { fps: number; frames: Frame[] }>

export type AnimationName = keyof typeof animations

const HEAD = [4, 1]
const FACE = [HEAD[0] + 2, HEAD[1] + 5]
const BODY = [7, 13]
const ARMS = [BODY[0] - 3, BODY[1] - 4]
const LEGS = [BODY[0], BODY[1] + 4]

const neighbors = [
	[1, 0],
	[-1, 0],
	[0, 1],
	[0, -1],
]

type Grid = string[][]

function inside(x: number, y: number): boolean {
	return x >= 0 && x < width && y >= 0 && y < height
}

function stamp(grid: Grid, part: Part, ox: number, oy: number, front = false) {
	const cells: [number, number, string][] = []
	parts[part].forEach((row, y) => {
		for (let x = 0; x < row.length; x++) {
			if (row[x] !== '.') cells.push([ox + x, oy + y, row[x]])
		}
	})
	if (front) {
		const own = new Set(
			cells.filter(([, , c]) => c !== 'K').map(([x, y]) => `${x},${y}`),
		)
		for (const [x, y] of cells) {
			for (const [dx, dy] of neighbors) {
				const nx = x + dx
				const ny = y + dy
				if (!own.has(`${nx},${ny}`) && inside(nx, ny)) grid[ny][nx] = 'K'
			}
		}
	}
	for (const [x, y, c] of cells) {
		if (inside(x, y)) grid[y][x] = c
	}
}

function outline(grid: Grid): Grid {
	return grid.map((row, y) =>
		row.map((c, x) =>
			c === '.' &&
			neighbors.some(
				([dx, dy]) =>
					inside(x + dx, y + dy) && !'.K'.includes(grid[y + dy][x + dx]),
			)
				? 'K'
				: c,
		),
	)
}

export function compose(name: CharacterName, frame: Frame): string[] {
	const character: Character = characters[name]
	const { dy } = frame
	const grid: Grid = Array.from({ length: height }, () =>
		Array(width).fill('.'),
	)
	stamp(grid, frame.legs, LEGS[0], LEGS[1] + Math.min(dy, 0))
	stamp(grid, 'body', BODY[0], BODY[1] + dy)
	stamp(grid, character.head, HEAD[0], HEAD[1] + dy)
	for (const [part, x, y] of character.extras) {
		stamp(grid, part, HEAD[0] + x, HEAD[1] + dy + y)
	}
	stamp(grid, frame.face, FACE[0], FACE[1] + dy)
	stamp(grid, frame.arms, ARMS[0], ARMS[1] + dy, true)
	for (const [part, x, y] of frame.props ?? []) {
		stamp(grid, part, x, y + dy, true)
	}
	return outline(grid).map((row) => row.join(''))
}
