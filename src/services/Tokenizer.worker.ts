import { Tokenize } from "./Tokenizer"
import type { Token } from "./Tokenizer"

interface WorkerRequest {
    Version:  number
    Text:     string
    Lang:     string
    VisStart: number
}

interface WorkerResponse {
    Version:  number
    Tokens:   Token[]
    VisStart: number
}

addEventListener("message", (E: MessageEvent<WorkerRequest>) => {
    const { Version, Text, Lang, VisStart } = E.data
    performance.mark("nyx-tok-start")
    const Tokens = Tokenize(Text, Lang)
    performance.mark("nyx-tok-end")
    performance.measure(`nyx:tokenize [${Lang}]`, "nyx-tok-start", "nyx-tok-end")
    const Response: WorkerResponse = { Version, Tokens, VisStart }
    postMessage(Response)
})
