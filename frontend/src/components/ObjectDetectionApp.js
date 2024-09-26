import React, { useState, useEffect, useRef } from 'react';
import { Send, Info, Loader, Camera, CameraOff } from 'lucide-react';
import io from 'socket.io-client';
import axios from 'axios';

const socket = io('http://localhost:5001', {
  transports: ['websocket'],
  cors: {
    origin: 'http://localhost:3000',
    methods: ["GET", "POST"]
  }
});

const ObjectDetectionApp = () => {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [error, setError] = useState(null);
  const [cameraStatus, setCameraStatus] = useState('checking');
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    checkCameraStatus();

    socket.on('connect', () => {
      console.log('Socket.IO bağlantısı başarılı');
    });

    socket.on('connect_error', (error) => {
      console.error('Socket.IO bağlantı hatası:', error);
      setError(`Sunucu bağlantısı kurulamadı: ${error.message}`);
    });

    socket.on('answer', (data) => {
      setAnswer(data.answer);
      setIsLoading(false);
    });

    return () => {
      socket.off('connect');
      socket.off('connect_error');
      socket.off('answer');
    };
  }, []);

  const checkCameraStatus = async () => {
    try {
      console.log("Kamera durumu kontrol ediliyor...");
      const response = await axios.get('http://localhost:5001/check_camera');
      console.log("Kamera durumu cevabı:", response.data);
      if (response.data.status === 'success') {
        console.log("Kamera erişimi başarılı.");
        setCameraStatus('available');
        initializeCamera();
      } else {
        console.error("Kamera erişimi başarısız:", response.data.message);
        setCameraStatus('unavailable');
        setError(`Kamera erişimi sağlanamadı: ${response.data.message}`);
      }
    } catch (error) {
      console.error("Kamera durumu kontrol edilirken hata oluştu:", error);
      setCameraStatus('unavailable');
      setError(`Kamera durumu kontrol edilemedi: ${error.message}`);
    }
  };

  const initializeCamera = () => {
    const videoElement = videoRef.current;
    if (videoElement) {
      navigator.mediaDevices.getUserMedia({ video: true })
        .then((stream) => {
          videoElement.srcObject = stream;
          videoElement.play()
            .then(() => {
              console.log("Video akışı başarıyla başlatıldı.");
              startFrameCapture();
            })
            .catch((error) => {
              console.error("Video oynatma hatası:", error);
              setError(`Video oynatılamadı: ${error.message}`);
            });
        })
        .catch((err) => {
          console.error("Kamera erişimi reddedildi:", err);
          setCameraStatus('unavailable');
          setError(`Kamera erişimi reddedildi: ${err.message}`);
        });
    }
  };

  const startFrameCapture = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    const captureFrame = () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const frame = canvas.toDataURL('image/jpeg');
        socket.emit('frame', { frame });
      }
      requestAnimationFrame(captureFrame);
    };

    captureFrame();
  };

  const askQuestion = () => {
    if (!question.trim()) {
      setError("Lütfen bir soru girin.");
      return;
    }
    setIsLoading(true);
    setError(null);
    socket.emit('ask_question', { question });
  };

  return (
    <div className="min-h-screen bg-gray-100 py-6 flex flex-col justify-center sm:py-12">
      <div className="relative py-3 sm:max-w-xl sm:mx-auto">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-400 to-blue-500 shadow-lg transform -skew-y-6 sm:skew-y-0 sm:-rotate-6 sm:rounded-3xl"></div>
        <div className="relative px-4 py-10 bg-white shadow-lg sm:rounded-3xl sm:p-20">
          <div className="max-w-md mx-auto">
            <div>
              <h1 className="text-2xl font-semibold text-center">Live Object Detection & Q&A</h1>
            </div>
            <div className="divide-y divide-gray-200">
              <div className="py-8 text-base leading-6 space-y-4 text-gray-700 sm:text-lg sm:leading-7">
                <div className="relative bg-black aspect-video rounded-lg overflow-hidden">
                  {cameraStatus === 'available' ? (
                    <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 w-full h-full flex items-center justify-center bg-gray-800 text-white">
                      {cameraStatus === 'checking' ? (
                        <Loader className="animate-spin" />
                      ) : (
                        <>
                          <CameraOff className="mr-2" />
                          <span>Kamera kullanılamıyor</span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                <div className="flex items-center space-x-2">
                  <input 
                    type="text" 
                    placeholder="Görüntü hakkında bir soru sorun..." 
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    className="flex-grow px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
                  <button 
                    onClick={askQuestion} 
                    disabled={isLoading}
                    className="px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 disabled:opacity-50"
                  >
                    {isLoading ? <Loader className="animate-spin" /> : <Send />}
                  </button>
                </div>
                {error && (
                  <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
                    <strong className="font-bold">Hata: </strong>
                    <span className="block sm:inline">{error}</span>
                    <p className="mt-2">
                      Lütfen tarayıcı ayarlarınızdan kamera erişimine izin verdiğinizden emin olun.
                      Sorun devam ederse, farklı bir tarayıcı veya cihaz deneyebilirsiniz.
                    </p>
                  </div>
                )}
                {answer && (
                  <div className="bg-green-100 border-l-4 border-green-500 text-green-700 p-4" role="alert">
                    <p className="font-bold">Cevap</p>
                    <p>{answer}</p>
                  </div>
                )}
                <button
                  onClick={() => setShowInfo(!showInfo)}
                  className="mt-4 text-cyan-500 hover:text-cyan-600 focus:outline-none"
                >
                  <Info className="inline-block mr-2" />
                  {showInfo ? 'Bilgiyi Gizle' : 'Nasıl Çalışır?'}
                </button>
                {showInfo && (
                  <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                    <h3 className="font-bold text-lg mb-2">Nasıl Çalışır?</h3>
                    <p>
                      Bu uygulama, gerçek zamanlı olarak nesneleri tespit etmek ve onlar hakkındaki sorularınızı yanıtlamak için gelişmiş yapay zeka kullanır. Kameranızı bir nesneye doğrultun ve soru sormaya başlayın!
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ObjectDetectionApp;