from flask import Flask, render_template, Response, send_from_directory, jsonify
from flask_socketio import SocketIO, emit
from flask_cors import CORS
import cv2
import numpy as np
from ultralytics import YOLO
from openai import OpenAI
import os
import base64
import logging
from dotenv import load_dotenv
import platform

app = Flask(__name__, static_folder='../frontend/build')
CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", max_http_buffer_size=1e8, logger=True, engineio_logger=True)

logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')

load_dotenv()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

try:
    model = YOLO("yolov8n.pt")
except Exception as e:
    logging.error(f"YOLO modeli yüklenirken hata oluştu: {e}")
    exit(1)

cap = None

def initialize_camera():
    global cap
    if platform.system() == "Darwin":  # macOS için
        cap = cv2.VideoCapture(0)
    else:
        for i in range(-1, 10):  # Diğer sistemler için daha fazla kamera indeksi deneyelim
            cap = cv2.VideoCapture(i)
            if cap.isOpened():
                logging.info(f"Kamera {i} başarıyla açıldı.")
                break
            else:
                cap.release()  # Açılamayan kamerayı serbest bırakalım

    if cap is None or not cap.isOpened():
        logging.error("Hiçbir kamera açılamadı. Sistem kameraları: %s", cv2.videoCapture.getBackendName())
        return False
    return True

initialize_camera()

def encode_image(image):
    _, buffer = cv2.imencode('.jpg', image)
    return base64.b64encode(buffer).decode('utf-8')

last_frame = None
last_detected_objects = []

def generate_frames():
    global cap, model, last_frame, last_detected_objects
    while True:
        if cap is None or not cap.isOpened():
            logging.error("Kamera bağlantısı yok veya açık değil.")
            if not initialize_camera():
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + b'\r\n')
                continue

        success, frame = cap.read()
        if not success:
            logging.error("Kameradan frame okunamadı.")
            if not initialize_camera():
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + b'\r\n')
                continue
        else:
            logging.info(f"Frame başarıyla okundu. Boyut: {frame.shape}")

        try:
            results = model(frame)
            detected_objects = []
            for r in results:
                boxes = r.boxes
                for box in boxes:
                    x1, y1, x2, y2 = box.xyxy[0]
                    class_name = r.names[int(box.cls)]
                    cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
                    cv2.putText(frame, class_name, (int(x1), int(y1) - 10),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 0), 2)
                    detected_objects.append(class_name)
            
            last_frame = frame.copy()
            last_detected_objects = detected_objects
            
            ret, buffer = cv2.imencode('.jpg', frame)
            frame = buffer.tobytes()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        except Exception as e:
            logging.error(f"Frame işlenirken hata oluştu: {e}")
            continue

@app.route('/video_feed')
def video_feed():
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/check_camera')
def check_camera():
    global cap
    if cap is None or not cap.isOpened():
        if not initialize_camera():
            logging.error("Kamera açılamadı veya erişim sağlanamadı.")
            return jsonify({"status": "error", "message": "Kamera erişimi sağlanamadı."}), 500
    
    ret, frame = cap.read()
    if not ret or frame is None:
        logging.error("Kameradan frame okunamadı.")
        return jsonify({"status": "error", "message": "Kameradan görüntü alınamadı."}), 500
    
    logging.info("Kamera başarıyla kontrol edildi.")
    return jsonify({"status": "success", "message": "Kamera erişimi başarılı."}), 200

@socketio.on('ask_question')
def handle_question(data):
    global last_frame, last_detected_objects
    question = data['question']
    logging.info(f"Soru alındı: {question}")
    
    if last_frame is None:
        emit('answer', {'answer': "Üzgünüm, henüz bir görüntü alınamadı."})
        return
    
    base64_image = encode_image(last_frame)
    
    logging.info("GPT-4 Vision API'ye istek gönderiliyor...")
    try:
        response = client.chat.completions.create(
            model="gpt-4-vision-preview",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": f"Bu görüntü hakkında bir sorum var: {question}. Tespit edilen nesneler: {', '.join(last_detected_objects)}"},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            max_tokens=300
        )
        emit('answer', {'answer': response.choices[0].message.content})
    except Exception as e:
        logging.error(f"GPT-4 Vision API'ye istek gönderilirken hata oluştu: {e}")
        emit('answer', {'answer': "Üzgünüm, bir hata oluştu. Lütfen daha sonra tekrar deneyin."})

@socketio.on('frame')
def handle_frame(data):
    logging.info(f"Frame alındı: {data}")
    # Burada frame'i işleyebilir veya kaydedebilirsiniz

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve(path):
    if path != "" and os.path.exists(app.static_folder + '/' + path):
        return send_from_directory(app.static_folder, path)
    else:
        return send_from_directory(app.static_folder, 'index.html')

if __name__ == '__main__':
    socketio.run(app, debug=True, port=5001, allow_unsafe_werkzeug=True)