<template>
  <div v-if="visible && text" class="debug-stats" aria-live="off">
    <span>DEBUG</span>
    <strong>{{ text }}</strong>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean;
  text: string;
}>();
</script>

<style scoped>
.debug-stats {
  position: fixed;
  top: max(24px, calc(env(safe-area-inset-top) + 24px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 8;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.045)),
    var(--surface);
  -webkit-backdrop-filter: var(--ui-blur);
  backdrop-filter: var(--ui-blur);
  color: rgba(255, 255, 255, 0.78);
  font-size: 11px;
  line-height: 1;
  pointer-events: none;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.16);
}

.debug-stats span {
  color: rgba(143, 244, 223, 0.86);
  font-weight: 700;
}

.debug-stats strong {
  color: rgba(255, 255, 255, 0.9);
  font-weight: 600;
}

@media (max-width: 680px) {
  .debug-stats {
    top: max(120px, calc(env(safe-area-inset-top) + 120px));
  }
}
</style>
