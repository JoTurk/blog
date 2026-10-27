---
title: Home
---

<script setup>
import { data as posts } from './posts/posts.data'
</script>

# Posts

<ul>
  <li v-for="post of posts" :key="post.url">
    <a :href="post.url">{{ post.title }}</a>
    <time :datetime="post.date">{{ new Date(post.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) }}</time>
  </li>
</ul>
