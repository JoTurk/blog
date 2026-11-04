<script setup lang="ts">
defineProps<{
	label?: string
}>()
</script>

<template>
	<figure class="demo">
		<p v-if="label" class="demo-label">{{ label }}</p>
		<slot name="tabs" />
		<div v-if="$slots.controls" class="demo-controls">
			<slot name="controls" />
		</div>
		<slot />
		<figcaption v-if="$slots.caption" class="demo-caption">
			<slot name="caption" />
		</figcaption>
	</figure>
</template>

<style>
.demo {
	--demo-rule: color-mix(in srgb, var(--rule) 65%, transparent);
	min-width: 0;
	margin: 28px 0;
	padding: 16px;
	border-block: 1px solid var(--rule);
	background: var(--code);
	font-size: 0.875rem;
	line-height: 1.5;
	font-variant-numeric: tabular-nums;
}

.demo-label {
	margin: 0 0 12px;
	color: var(--text);
	font: 500 0.875rem / 1.4 var(--font-sans);
}

.demo-controls {
	display: flex;
	flex-wrap: wrap;
	gap: 8px 16px;
	align-items: center;
	margin-bottom: 14px;
	padding-bottom: 10px;
	border-bottom: 1px solid var(--demo-rule);
	font-size: 0.8125rem;
}

.demo-controls label {
	display: flex;
	gap: 6px;
	align-items: center;
	min-width: 0;
	color: var(--muted);
	cursor: pointer;
}

.demo-controls output {
	min-width: 4ch;
	color: var(--text);
	font-family: var(--font-mono);
}

.demo input[type="range"],
.demo input[type="checkbox"],
.demo input[type="radio"] {
	accent-color: var(--accent);
}

.demo :where(input[type="range"]) {
	width: 120px;
	max-width: 100%;
	height: 24px;
	margin: 0;
	appearance: none;
	background: transparent;
	cursor: pointer;
}

.demo input[type="range"]::-webkit-slider-runnable-track {
	height: 2px;
	background: var(--rule);
}

.demo input[type="range"]::-moz-range-track {
	height: 2px;
	background: var(--rule);
}

.demo input[type="range"]::-webkit-slider-thumb {
	width: 12px;
	height: 12px;
	margin-top: -5px;
	border: 0;
	border-radius: 50%;
	appearance: none;
	background: var(--accent);
}

.demo input[type="range"]::-moz-range-thumb {
	width: 12px;
	height: 12px;
	border: 0;
	border-radius: 50%;
	background: var(--accent);
}

.demo-btn {
	padding: 5px 10px;
	border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--rule));
	border-radius: 3px;
	background: var(--bubble);
	color: var(--bubbletext);
	font: 500 0.8125rem / 1.4 var(--font-sans);
	cursor: pointer;
}

.demo-btn:hover:not(:disabled) {
	border-color: var(--accent);
	color: var(--bubbletext);
}

.demo-btn[data-longest]::after {
	content: attr(data-longest);
	display: block;
	height: 0;
	overflow: hidden;
	visibility: hidden;
}

.demo button:focus-visible,
.demo input:focus-visible,
.demo select:focus-visible {
	outline: 2px solid var(--accent);
	outline-offset: 3px;
}

.demo-btn:disabled {
	opacity: 0.45;
	cursor: default;
}

.demo-btn.secondary {
	border-color: var(--rule);
	background: transparent;
	color: var(--text);
}

.demo-btn.danger {
	border-color: color-mix(in srgb, var(--danger) 45%, var(--rule));
	background: transparent;
	color: var(--danger);
}

.demo-btn.danger:hover:not(:disabled) {
	border-color: var(--danger);
	color: var(--danger);
}

.demo-tabs {
	display: flex;
	flex-wrap: wrap;
	gap: 4px 16px;
	margin-bottom: 12px;
	border-bottom: 1px solid var(--demo-rule);
}

.demo-tabs button {
	margin-bottom: -1px;
	padding: 4px 0;
	border: 0;
	border-bottom: 1px solid transparent;
	border-radius: 0;
	background: none;
	color: var(--muted);
	font: 400 0.8125rem / 1.5 var(--font-sans);
	cursor: pointer;
}

.demo-tabs button:hover {
	color: var(--text);
}

.demo-tabs button[aria-pressed="true"] {
	border-bottom-color: var(--accent);
	color: var(--text);
}

.demo-mono {
	font-family: var(--font-mono);
}

.demo code {
	padding: 0;
	background: transparent;
}

.demo-bytes {
	display: flex;
	flex-wrap: wrap;
	gap: 2px;
	font: 0.8125rem / 1 var(--font-mono);
}

.demo-bytes > * {
	display: grid;
	place-items: center;
	min-width: 24px;
	height: 24px;
	padding: 0 3px;
}

.demo-note {
	margin: 6px 0 0;
	color: var(--muted);
	font: 0.8125rem / 1.45 var(--font-sans);
}

.demo-ok {
	color: var(--tip);
}

.demo-bad {
	color: var(--danger);
}

.demo-warn {
	color: var(--warning);
}

.demo-caption {
	margin-top: 10px;
	color: var(--muted);
	font-size: 0.8125rem;
	line-height: 1.5;
}

@media (max-width: 520px) {
	.demo {
		margin-block: 24px;
		margin-inline: -12px;
		padding: 14px 12px;
	}
}
</style>
