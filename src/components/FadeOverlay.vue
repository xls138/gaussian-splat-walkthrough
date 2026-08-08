<template>
  <div id="fade" :class="['fade', { visible }]">
    <div v-if="visible && progress.active" class="loading-panel">
      <div class="loading-heading">Loading</div>
      <div class="loading-resource">{{ progress.name }}</div>
      <div class="loading-track" aria-hidden="true">
        <div class="loading-bar" :style="{ width: `${progress.percent}%` }"></div>
      </div>
      <div class="loading-stats">
        <span>{{ progress.sizeText }}</span>
        <span>{{ progress.percentText }}</span>
        <span>{{ progress.speedText }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  visible: boolean;
  progress: {
    active: boolean;
    name: string;
    sizeText: string;
    percent: number;
    percentText: string;
    speedText: string;
  };
}>();
</script>
