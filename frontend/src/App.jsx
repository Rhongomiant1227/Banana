import { useState, useEffect, useCallback, useRef } from 'react'
import { 
  Sparkles, 
  Image as ImageIcon, 
  Clipboard, 
  Download, 
  Loader2, 
  Trash2,
  Settings,
  History,
  X,
  Check,
  AlertCircle,
  Upload,
  Key
} from 'lucide-react'

const API_BASE = ''

// 宽高比选项（留空表示自动）
const ASPECT_RATIOS = [
  { value: '', label: '自动', desc: '由模型决定' },
  { value: '1:1', label: '1:1 正方形' },
  { value: '16:9', label: '16:9 横版' },
  { value: '9:16', label: '9:16 竖版' },
  { value: '4:3', label: '4:3 传统' },
  { value: '3:4', label: '3:4 人像' },
  { value: '3:2', label: '3:2 相机' },
  { value: '2:3', label: '2:3 海报' },
]

// 模型选项
const MODELS = [
  { value: 'nano-banana-pro', label: 'Nano Banana Pro', desc: 'Gemini 3 Pro · 专业版 · 支持4K' },
  { value: 'nano-banana', label: 'Nano Banana', desc: 'Gemini 2.5 Flash · 快速版' },
]

// 图像尺寸（仅 Pro 支持）
const IMAGE_SIZES = [
  { value: '', label: '默认 (1K)' },
  { value: '2K', label: '2K 高清' },
  { value: '4K', label: '4K 超清' },
]

function App() {
  const [prompt, setPrompt] = useState('')
  const [aspectRatio, setAspectRatio] = useState('')  // 默认自动
  const [model, setModel] = useState('nano-banana-pro')  // 默认 Gemini 3 Pro
  const [imageSize, setImageSize] = useState('')  // 仅 Pro 支持
  const [referenceImage, setReferenceImage] = useState(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [currentTask, setCurrentTask] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  
  // API 密钥相关状态
  const [apiKey, setApiKey] = useState('')
  const [savedKeyInfo, setSavedKeyInfo] = useState({ has_key: false, masked_key: '' })
  const [showApiSettings, setShowApiSettings] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [keyStatus, setKeyStatus] = useState(null) // null, 'valid', 'invalid'
  
  const fileInputRef = useRef(null)
  const pollIntervalRef = useRef(null)

  // 初始化时检查API密钥
  useEffect(() => {
    checkApiKey()
  }, [])

  // 检查API密钥状态
  const checkApiKey = async () => {
    try {
      const response = await fetch(`${API_BASE}/api/check-key`)
      const data = await response.json()
      setSavedKeyInfo(data)
      if (!data.has_key) {
        setShowApiSettings(true)
      }
    } catch (err) {
      console.error('检查API密钥失败:', err)
    }
  }

  // 验证并保存API密钥
  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      setError('请输入API密钥')
      return
    }

    setIsVerifying(true)
    setKeyStatus(null)
    setError(null)

    try {
      // 先验证密钥
      const verifyRes = await fetch(`${API_BASE}/api/verify-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: apiKey.trim() })
      })
      const verifyData = await verifyRes.json()

      if (verifyData.valid) {
        // 验证通过，保存密钥
        await fetch(`${API_BASE}/api/set-key`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: apiKey.trim() })
        })
        setKeyStatus('valid')
        setSavedKeyInfo({ has_key: true, masked_key: apiKey.slice(0, 8) + '...' + apiKey.slice(-4) })
        setTimeout(() => {
          setShowApiSettings(false)
          setApiKey('')
          setKeyStatus(null)
        }, 1500)
      } else {
        setKeyStatus('invalid')
        setError(verifyData.message)
      }
    } catch (err) {
      setKeyStatus('invalid')
      setError('验证失败: ' + err.message)
    } finally {
      setIsVerifying(false)
    }
  }

  // 剪贴板粘贴处理
  useEffect(() => {
    const handlePaste = async (e) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          await handleImageFile(file)
          break
        }
      }
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  // 处理图片文件
  const handleImageFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) return

    const reader = new FileReader()
    reader.onload = (e) => {
      setReferenceImage({
        url: e.target.result,
        name: file.name
      })
    }
    reader.readAsDataURL(file)
  }

  // 拖拽处理
  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragOver(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    setIsDragOver(false)
    
    const file = e.dataTransfer.files[0]
    if (file) {
      await handleImageFile(file)
    }
  }

  // 文件选择
  const handleFileSelect = (e) => {
    const file = e.target.files[0]
    if (file) {
      handleImageFile(file)
    }
  }

  // 轮询任务状态
  const pollTaskStatus = useCallback(async (taskId) => {
    try {
      const response = await fetch(`${API_BASE}/api/task/${taskId}`)
      const data = await response.json()

      if (data.status === 'completed') {
        clearInterval(pollIntervalRef.current)
        // 优先使用 base64 数据，其次使用 URL
        const imageResult = data.result_base64 || data.result_url
        setResult(imageResult)
        setIsGenerating(false)
        setCurrentTask(null)
        
        // 添加到历史记录
        setHistory(prev => [{
          id: taskId,
          prompt: prompt,
          result_url: imageResult,
          model: data.model,
          created_at: new Date().toISOString()
        }, ...prev].slice(0, 20))
        
      } else if (data.status === 'failed') {
        clearInterval(pollIntervalRef.current)
        setError(data.error || '生成失败')
        setIsGenerating(false)
        setCurrentTask(null)
      } else {
        setCurrentTask(prev => ({ ...prev, progress: data.progress, model: data.model }))
      }
    } catch (err) {
      console.error('轮询错误:', err)
    }
  }, [prompt])

  // 提交生成任务
  const handleGenerate = async () => {
    if (!savedKeyInfo.has_key) {
      setError('请先设置API密钥')
      setShowApiSettings(true)
      return
    }

    if (!prompt.trim()) {
      setError('请输入提示词')
      return
    }

    setError(null)
    setResult(null)
    setIsGenerating(true)

    try {
      // 构建请求体
      const requestBody = {
        prompt: prompt.trim(),
        model: model,
        reference_images: referenceImage ? [referenceImage.url] : []
      }
      
      // 仅当选择了具体比例时才发送
      if (aspectRatio) {
        requestBody.aspect_ratio = aspectRatio
      }
      
      // Pro 模型支持图像尺寸
      if (imageSize && model === 'nano-banana-pro') {
        requestBody.image_size = imageSize
      }
      
      const response = await fetch(`${API_BASE}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      if (!response.ok) {
        const errData = await response.json()
        throw new Error(errData.detail || '请求失败')
      }

      const data = await response.json()
      setCurrentTask({ id: data.task_id, progress: 0 })

      // 开始轮询
      pollIntervalRef.current = setInterval(() => {
        pollTaskStatus(data.task_id)
      }, 2000)

    } catch (err) {
      setError(err.message)
      setIsGenerating(false)
    }
  }

  // 下载图片
  const handleDownload = async () => {
    if (!result) return
    
    try {
      const response = await fetch(result)
      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `nanobanana_${Date.now()}.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)
    } catch (err) {
      // 直接打开链接
      window.open(result, '_blank')
    }
  }

  // 清理
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-yellow-50">
      {/* 顶部导航 */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-banana-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-banana-400 to-banana-500 rounded-xl flex items-center justify-center shadow-lg shadow-banana-200">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-800">Nano Banana</h1>
              <p className="text-xs text-gray-500">基于智增增平台</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="p-2 text-gray-600 hover:text-banana-600 hover:bg-banana-50 rounded-lg transition-colors"
              title="历史记录"
            >
              <History className="w-5 h-5" />
            </button>
            
            <button
              onClick={() => setShowApiSettings(true)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
                savedKeyInfo.has_key 
                  ? 'bg-green-50 text-green-700 hover:bg-green-100' 
                  : 'bg-red-50 text-red-600 hover:bg-red-100 animate-pulse'
              }`}
              title="API设置"
            >
              <Key className="w-4 h-4" />
              <span className="text-sm">
                {savedKeyInfo.has_key ? savedKeyInfo.masked_key : '设置API密钥'}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-2 gap-8">
          {/* 左侧：输入区域 */}
          <div className="space-y-6">
            {/* 提示词输入 */}
            <div className="bg-white rounded-2xl shadow-lg shadow-gray-200/50 p-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                提示词 Prompt
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="描述你想要生成的图像，例如：日落时分的未来城市，飞行汽车穿梭于高楼之间..."
                className="w-full h-32 px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-banana-400 focus:border-transparent resize-none transition-shadow"
              />
              <div className="mt-2 flex justify-between items-center text-xs text-gray-400">
                <span>支持中英文提示词</span>
                <span>{prompt.length} 字符</span>
              </div>
            </div>

            {/* 参考图上传 */}
            <div className="bg-white rounded-2xl shadow-lg shadow-gray-200/50 p-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                参考图（可选）
              </label>
              
              <div
                className={`drop-zone cursor-pointer ${isDragOver ? 'drag-over' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                {referenceImage ? (
                  <div className="relative inline-block">
                    <img
                      src={referenceImage.url}
                      alt="参考图"
                      className="max-h-40 rounded-lg mx-auto"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setReferenceImage(null)
                      }}
                      className="absolute -top-2 -right-2 p-1 bg-red-500 text-white rounded-full hover:bg-red-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex justify-center">
                      <div className="p-3 bg-banana-50 rounded-full">
                        <Upload className="w-8 h-8 text-banana-500" />
                      </div>
                    </div>
                    <p className="text-gray-600">拖拽图片到这里，或点击上传</p>
                    <p className="text-sm text-gray-400 flex items-center justify-center gap-1">
                      <Clipboard className="w-4 h-4" />
                      支持 Ctrl+V 粘贴剪贴板图片
                    </p>
                  </div>
                )}
              </div>
              
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            {/* 参数设置 */}
            <div className="bg-white rounded-2xl shadow-lg shadow-gray-200/50 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Settings className="w-5 h-5 text-gray-400" />
                <span className="text-sm font-medium text-gray-700">生成参数</span>
              </div>
              
              {/* 模型选择 */}
              <div className="mb-4">
                <label className="block text-xs text-gray-500 mb-2">模型</label>
                <div className="grid grid-cols-2 gap-2">
                  {MODELS.map(m => (
                    <button
                      key={m.value}
                      onClick={() => setModel(m.value)}
                      className={`p-3 rounded-lg border-2 text-left transition-all ${
                        model === m.value
                          ? 'border-banana-400 bg-banana-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="font-medium text-sm">{m.label}</div>
                      <div className="text-xs text-gray-500 mt-1">{m.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="grid sm:grid-cols-2 gap-4">
                {/* 宽高比 */}
                <div>
                  <label className="block text-xs text-gray-500 mb-2">宽高比（可选）</label>
                  <select
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-banana-400 focus:border-transparent"
                  >
                    {ASPECT_RATIOS.map(ratio => (
                      <option key={ratio.value} value={ratio.value}>
                        {ratio.label}
                      </option>
                    ))}
                  </select>
                </div>
                
                {/* 图像尺寸 - 仅 Pro 支持 */}
                <div>
                  <label className="block text-xs text-gray-500 mb-2">
                    图像尺寸 {model !== 'nano-banana-pro' && <span className="text-gray-400">(仅Pro)</span>}
                  </label>
                  <select
                    value={imageSize}
                    onChange={(e) => setImageSize(e.target.value)}
                    disabled={model !== 'nano-banana-pro'}
                    className={`w-full px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-banana-400 focus:border-transparent ${
                      model !== 'nano-banana-pro' ? 'bg-gray-100 text-gray-400' : ''
                    }`}
                  >
                    {IMAGE_SIZES.map(size => (
                      <option key={size.value} value={size.value}>
                        {size.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* 生成按钮 */}
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              className={`w-full py-4 rounded-xl font-medium text-lg transition-all flex items-center justify-center gap-2
                ${isGenerating || !prompt.trim()
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-banana-400 to-banana-500 text-white hover:from-banana-500 hover:to-banana-600 shadow-lg shadow-banana-200 hover:shadow-xl hover:shadow-banana-300'
                }`}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  生成中... {currentTask?.progress || 0}%
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  生成图像
                </>
              )}
            </button>

            {/* 错误提示 */}
            {error && (
              <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-xl text-red-600">
                <AlertCircle className="w-5 h-5 flex-shrink-0" />
                <span>{error}</span>
                <button
                  onClick={() => setError(null)}
                  className="ml-auto p-1 hover:bg-red-100 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

          {/* 右侧：结果展示 */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-lg shadow-gray-200/50 p-6 min-h-[400px] flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium text-gray-700">生成结果</span>
                {result && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDownload}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm text-banana-600 hover:bg-banana-50 rounded-lg transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      下载
                    </button>
                    <button
                      onClick={() => setResult(null)}
                      className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 flex items-center justify-center">
                {isGenerating ? (
                  <div className="text-center space-y-4">
                    <div className="relative inline-flex">
                      <div className="w-20 h-20 bg-banana-100 rounded-full flex items-center justify-center">
                        <Sparkles className="w-10 h-10 text-banana-500" />
                      </div>
                      <div className="absolute inset-0 bg-banana-300 rounded-full pulse-ring opacity-50"></div>
                    </div>
                    <div>
                      <p className="text-gray-600 font-medium">正在生成中...</p>
                      <p className="text-sm text-gray-400 mt-1">
                        进度：{currentTask?.progress || 0}%
                      </p>
                    </div>
                    <div className="w-48 h-2 bg-gray-100 rounded-full overflow-hidden mx-auto">
                      <div
                        className="h-full bg-gradient-to-r from-banana-400 to-banana-500 transition-all duration-500"
                        style={{ width: `${currentTask?.progress || 0}%` }}
                      ></div>
                    </div>
                  </div>
                ) : result ? (
                  <img
                    src={result}
                    alt="生成结果"
                    className="max-w-full max-h-[500px] rounded-xl shadow-lg"
                  />
                ) : (
                  <div className="text-center text-gray-400 space-y-3">
                    <ImageIcon className="w-16 h-16 mx-auto opacity-30" />
                    <p>生成的图像将显示在这里</p>
                  </div>
                )}
              </div>
            </div>

            {/* 历史记录面板 */}
            {showHistory && history.length > 0 && (
              <div className="bg-white rounded-2xl shadow-lg shadow-gray-200/50 p-6">
                <h3 className="text-sm font-medium text-gray-700 mb-4">历史记录</h3>
                <div className="grid grid-cols-3 gap-3">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="relative group cursor-pointer"
                      onClick={() => setResult(item.result_url)}
                    >
                      <img
                        src={item.result_url}
                        alt={item.prompt}
                        className="w-full aspect-square object-cover rounded-lg"
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-end p-2">
                        <p className="text-white text-xs line-clamp-2">{item.prompt}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* API设置弹窗 */}
      {showApiSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800">API 密钥设置</h2>
              <button
                onClick={() => {
                  if (savedKeyInfo.has_key) {
                    setShowApiSettings(false)
                    setApiKey('')
                    setKeyStatus(null)
                  }
                }}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <p className="text-sm text-gray-600 mb-4">
              请输入智增增平台的 API 密钥。
              <a 
                href="https://zhizengzeng.com" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-banana-600 hover:underline ml-1"
              >
                获取密钥 →
              </a>
            </p>
            
            <div className="space-y-4">
              <div>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-xxxxxxxxxxxxxxxx"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-banana-400 focus:border-transparent"
                />
              </div>
              
              {keyStatus === 'valid' && (
                <div className="flex items-center gap-2 text-green-600 bg-green-50 px-4 py-2 rounded-lg">
                  <Check className="w-5 h-5" />
                  <span>API密钥验证成功！</span>
                </div>
              )}
              
              {keyStatus === 'invalid' && error && (
                <div className="flex items-center gap-2 text-red-600 bg-red-50 px-4 py-2 rounded-lg">
                  <AlertCircle className="w-5 h-5" />
                  <span>{error}</span>
                </div>
              )}
              
              <button
                onClick={handleSaveApiKey}
                disabled={isVerifying || !apiKey.trim()}
                className={`w-full py-3 rounded-xl font-medium flex items-center justify-center gap-2 transition-all ${
                  isVerifying || !apiKey.trim()
                    ? 'bg-gray-200 text-gray-400'
                    : 'bg-gradient-to-r from-banana-400 to-banana-500 text-white hover:from-banana-500 hover:to-banana-600'
                }`}
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    验证中...
                  </>
                ) : (
                  '验证并保存'
                )}
              </button>
              
              {savedKeyInfo.has_key && (
                <p className="text-center text-sm text-gray-500">
                  当前已配置: {savedKeyInfo.masked_key}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 底部 */}
      <footer className="mt-16 py-6 border-t border-gray-100">
        <p className="text-center text-sm text-gray-400">
          Powered by 智增增平台 · Nano Banana AI
        </p>
      </footer>
    </div>
  )
}

export default App
