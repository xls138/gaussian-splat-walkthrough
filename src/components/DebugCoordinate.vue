<template>
  <div
    id="debug-coordinate"
    :class="['debug-coordinate', { hidden: !visible }]"
    aria-hidden="true"
  >
    {{ text }}
  </div>
</template>

<script setup lang="ts">
defineProps<{
  text: string;
  visible: boolean;
}>();
</script>
