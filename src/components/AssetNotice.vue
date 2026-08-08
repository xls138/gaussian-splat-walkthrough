<template>
  <div
    id="asset-notice"
    :class="['asset-notice', { hidden: !visible }]"
    role="status"
  >
    {{ message }}
  </div>
</template>

<script setup lang="ts">
defineProps<{
  message: string;
  visible: boolean;
}>();
</script>
