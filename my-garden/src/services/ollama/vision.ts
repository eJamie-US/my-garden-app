import axios from 'axios'
import type { VisionResult } from '../../types'

const OLLAMA_API = import.meta.env.VITE_OLLAMA_API_URL || 'http://localhost:11434'

export const ollamaService = {
  async identifyPlant(imageBase64: string): Promise<VisionResult> {
    try {
      const response = await axios.post(`${OLLAMA_API}/api/generate`, {
        model: 'llava-phi',
        prompt: `You are a plant expert. Analyze this image and provide:
1. Plant species name
2. Confidence level (0-100)
3. Care instructions
4. Watering needs
5. Sunlight requirements
6. Common issues and solutions

Format as JSON.`,
        images: [imageBase64],
        stream: false,
      })

      const responseText = response.data.response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      
      if (!jsonMatch) {
        throw new Error('Could not parse plant identification response')
      }

      return JSON.parse(jsonMatch[0])
    } catch (error) {
      console.error('Ollama error:', error)
      throw new Error('Failed to identify plant')
    }
  },

  async checkPlantHealth(imageBase64: string) {
    try {
      const response = await axios.post(`${OLLAMA_API}/api/generate`, {
        model: 'llava-phi',
        prompt: `Analyze this plant image and provide a health assessment. Check for:
- Disease symptoms
- Nutrient deficiencies
- Pest damage
- Overall health score (1-10)
- Recommended actions

Format as JSON.`,
        images: [imageBase64],
        stream: false,
      })

      const responseText = response.data.response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/)
      
      if (!jsonMatch) {
        throw new Error('Could not parse health assessment')
      }

      return JSON.parse(jsonMatch[0])
    } catch (error) {
      console.error('Ollama health check error:', error)
      throw new Error('Failed to assess plant health')
    }
  },
}
