<template>
  <div
    id="toast"
    :class="['toast', { visible, error: isError }]"
    role="status"
  >
    {{ message }}
  </div>
</template>

<script setup lang="ts">
defineProps<{
  message: string;
  visible: boolean;
  isError: boolean;
}>();
</script>
