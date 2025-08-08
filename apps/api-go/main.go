package main

import (
    "encoding/json"
    "log"
    "net/http"
)

func handler(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(map[string]string{"service": "api-go", "status": "ok"})
}

func main() {
    http.HandleFunc("/", handler)
    log.Println("api-go listening on :8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}

