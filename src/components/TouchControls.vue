<template>
  <div class="touch-controls">
    <div ref="stickRef" class="stick">
      <div ref="knobRef" class="knob"></div>
    </div>
    <button
      ref="crouchRef"
      :class="['crouch-button', { active: isCrouching }]"
      type="button"
      :aria-pressed="isCrouching ? 'true' : 'false'"
    >
      <span>下蹲</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

defineProps<{
  isCrouching: boolean;
}>();

const stickRef = ref<HTMLElement | null>(null);
const knobRef = ref<HTMLElement | null>(null);
const crouchRef = ref<HTMLElement | null>(null);

defineExpose({ stickRef, knobRef, crouchRef });
</script>
