<script setup>
import { ref } from 'vue'
import { useApi } from '../composables/useApi'

const emit = defineEmits(['created'])
const { createMarket } = useApi()

const title = ref('')
const description = ref('')
const tagsInput = ref('')
const resolutionMethod = ref('creator')
const closesAt = ref('')
const optionInputs = ref(['', ''])
const creating = ref(false)
const error = ref(null)

function addOption() {
  optionInputs.value.push('')
}

function removeOption(i) {
  if (optionInputs.value.length > 2) {
    optionInputs.value.splice(i, 1)
  }
}

async function submit() {
  const options = optionInputs.value.map(s => s.trim()).filter(Boolean)
  if (!title.value.trim() || options.length < 2) {
    error.value = 'Title and at least 2 options required'
    return
  }
  creating.value = true
  error.value = null
  try {
    const tags = tagsInput.value.split(',').map(t => t.trim().toLowerCase()).filter(Boolean)
    await createMarket({
      title: title.value.trim(),
      description: description.value.trim() || undefined,
      resolutionMethod: resolutionMethod.value,
      closesAt: closesAt.value || undefined,
      options,
      tags,
    })
    emit('created')
  } catch (err) {
    error.value = err.message
  }
  creating.value = false
}
</script>

<template>
  <div class="create-form">
    <div class="form-group">
      <label>Question</label>
      <input v-model="title" class="form-control" placeholder="Will it rain tomorrow?" />
    </div>

    <div class="form-group">
      <label>Description (optional)</label>
      <textarea v-model="description" class="form-control" placeholder="Extra details..."></textarea>
    </div>

    <div class="form-group">
      <label>Tags (optional, comma-separated)</label>
      <input v-model="tagsInput" class="form-control" placeholder="e.g. pvp, events, guild" />
    </div>

    <div class="form-group">
      <label>Options</label>
      <div v-for="(_, i) in optionInputs" :key="i" class="option-row">
        <input v-model="optionInputs[i]" class="form-control option-input" :placeholder="'Option ' + (i + 1)" />
        <button v-if="optionInputs.length > 2" class="remove-btn" @click="removeOption(i)">×</button>
      </div>
      <button class="add-option-btn" @click="addOption">+ Add option</button>
    </div>

    <div class="form-group">
      <label>Resolution method</label>
      <select v-model="resolutionMethod" class="form-control">
        <option value="creator">Creator resolves</option>
        <option value="moderator">Moderator resolves</option>
        <option value="vote">Community vote</option>
      </select>
    </div>

    <div class="form-group">
      <label>Closes at (optional)</label>
      <input v-model="closesAt" type="datetime-local" class="form-control" />
    </div>

    <div v-if="error" class="form-error">{{ error }}</div>

    <button class="btn" :disabled="creating" @click="submit">
      {{ creating ? 'Creating...' : 'Create Market' }}
    </button>
  </div>
</template>

<style scoped>
.create-form {
  max-width: 480px;
}

.option-row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}

.option-input {
  flex: 1;
}

.remove-btn {
  background: none;
  border: 1px solid var(--border);
  color: var(--muted);
  width: 32px;
  cursor: pointer;
  font-size: 1rem;
  font-family: inherit;
}
.remove-btn:hover {
  color: #e94560;
  border-color: #e94560;
}

.add-option-btn {
  background: none;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 0.8rem;
  font-family: inherit;
  padding: 4px 0;
}
.add-option-btn:hover {
  color: var(--accent-hover);
}

.form-error {
  color: #e94560;
  font-size: 0.8rem;
  margin-bottom: 8px;
}
</style>
