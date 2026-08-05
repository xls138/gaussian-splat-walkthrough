<template>
  <canvas ref="canvasRef" id="game"></canvas>
  <div id="app-ui" class="ui" aria-live="polite">
    
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount, onMounted, watch, nextTick } from "vue";
const canvasRef = ref<HTMLCanvasElement | null>(null);
</script>