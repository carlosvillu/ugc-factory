Full-width banner shown when a pipeline run is paused at a checkpoint (CP1–CP5). Composes `Button`; the approve action is the one place a solid success-green button appears in this system.

```jsx
<CheckpointBanner
  title="CP1 · Brief listo para revisión"
  description="El pipeline está en pausa. Revisa el brief antes de continuar."
  onApprove={approve} onEdit={openEditor} onReject={reject}
/>
```
