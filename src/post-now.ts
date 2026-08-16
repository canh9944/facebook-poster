import { publishPost } from "./facebook.js";

const content = `💡 Một góc nhìn đơn giản về AI và công nghệ

Thay vì cố gắng học tất cả mọi thứ cùng lúc, hãy chọn một vấn đề nhỏ và giải quyết nó thật tốt.

Tiến bộ nhỏ mỗi ngày sẽ tạo ra khác biệt rất lớn sau một thời gian.

Anh em đang tìm hiểu AI và công nghệ đến đâu rồi? 👇`;

await publishPost(content);

console.log("Publish completed");
