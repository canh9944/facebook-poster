export function generatePost(topic: string) {
  const templates = [
    `🔥 ${topic}

Có một điều rất nhiều người đang bỏ qua:

Không phải cứ làm nhiều là sẽ có kết quả tốt.

Quan trọng hơn là biết mình đang làm gì, vì sao làm và cách cải thiện từng ngày.

Nếu anh cũng đang quan tâm đến ${topic}, hãy lưu lại bài này nhé.

#${topic.replace(/\s+/g, "")} #LearnEveryDay`,

    `💡 Một góc nhìn đơn giản về ${topic}

Thay vì cố gắng học tất cả mọi thứ cùng lúc, hãy chọn một vấn đề nhỏ và giải quyết nó thật tốt.

Tiến bộ nhỏ mỗi ngày sẽ tạo ra khác biệt rất lớn sau một thời gian.

Anh em đang tìm hiểu ${topic} đến đâu rồi? 👇`,

    `🚀 Nếu đang bắt đầu với ${topic}, đừng mắc sai lầm này.

Đừng chỉ đọc và xem tutorial.

Hãy bắt tay làm một project nhỏ.

Làm → sai → sửa → hiểu.

Đó là cách học nhanh nhất.

#${topic.replace(/\s+/g, "")}`,
  ];

  return templates[Math.floor(Math.random() * templates.length)];
}
