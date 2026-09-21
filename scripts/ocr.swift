// macOS Vision 온디바이스 OCR (무료·오프라인). 사용: swift scripts/ocr.swift <이미지경로>
// 결과: 인식된 줄들을 위→아래 순서로 stdout 출력.
import Foundation
import Vision
import AppKit

guard CommandLine.arguments.count > 1,
      let img = NSImage(contentsOfFile: CommandLine.arguments[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(2) }
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["ko-KR", "en-US"]
req.usesLanguageCorrection = true
try VNImageRequestHandler(cgImage: cg).perform([req])
let lines = (req.results ?? [])
  .compactMap { o -> (CGFloat, CGFloat, String)? in
    guard let t = o.topCandidates(1).first?.string else { return nil }
    return (o.boundingBox.minY, o.boundingBox.minX, t) }
  .sorted { abs($0.0 - $1.0) > 0.01 ? $0.0 > $1.0 : $0.1 < $1.1 }
print(lines.map { $0.2 }.joined(separator: "\n"))
