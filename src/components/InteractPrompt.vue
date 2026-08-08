<template>
  <div :class="['action-frame', 'interact-frame', { hidden: !visible }]">
    <button
      :class="['interact-button', { 'keyboard-prompt': keyboardPrompt }]"
      type="button"
      @click="$emit('click')"
    >
      <span>{{ label }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean;
  label: string;
  keyboardPrompt: boolean;
}>();
defineEmits<{
  click: [];
}>();
</script>
