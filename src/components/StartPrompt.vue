<template>
  <div :class="['action-frame', 'start-frame', { hidden: !visible }]">
    <button class="start-button" type="button" @click="$emit('click')">
      <span>进入场景</span>
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean;
}>();
defineEmits<{
  click: [];
}>();
</script>
