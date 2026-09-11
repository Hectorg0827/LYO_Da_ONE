import SwiftUI

struct ChatOverlayView: View {
    @ObservedObject var viewModel: LyoAIViewModel
    var onClose: () -> Void
    
    var body: some View {
        ZStack {
            // Dimmed Background
            Color.black.opacity(0.6)
                .ignoresSafeArea()
                .onTapGesture(perform: onClose)
            
            // Chat Sheet
            VStack(spacing: 0) {
                // Header
                HStack {
                    Text("LYO")
                        .font(.headline)
                        .foregroundColor(.white)
                    
                    Spacer()
                    
                    Button(action: onClose) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 24))
                            .foregroundColor(Color("LyoTextSecondary"))
                    }
                }
                .padding()
                .background(Color("LyoSurface"))
                
                // Messages
                ScrollView {
                    LazyVStack(spacing: 16) {
                        ForEach(viewModel.messages) { message in
                            LyoMessageBubbleView(
                                message: message,
                                onActionTap: { action in
                                    viewModel.executeAction(action)
                                },
                                onQuickChipTap: { chip in
                                    viewModel.inputText = chip
                                    Task { await viewModel.sendMessage() }
                                },
                                onCourseStart: { course in
                                    viewModel.inputText = "Start course: \(course.title)"
                                    Task { await viewModel.sendMessage() }
                                }
                            )
                        }
                        
                        if viewModel.isLoading {
                            HStack {
                                ProgressView()
                                    .tint(.white)
                                Text("Lyo is thinking...")
                                    .font(.caption)
                                    .foregroundColor(.gray)
                            }
                            .padding()
                        }
                    }
                    .padding()
                }
                
                // Composer
                VStack(spacing: 0) {
                    Divider().background(Color.gray.opacity(0.3))
                    
                    HStack(spacing: 12) {
                        TextField("Ask anything...", text: $viewModel.inputText)
                            .padding(12)
                            .background(Color.white.opacity(0.1))
                            .cornerRadius(20)
                            .foregroundColor(.white)
                        
                        Button(action: {
                            Task {
                                await viewModel.sendMessage()
                            }
                        }) {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.system(size: 32))
                                .foregroundColor(Color("LyoAccent"))
                        }
                        .disabled(viewModel.inputText.isEmpty)
                    }
                    .padding()
                    .background(Color("LyoSurface"))
                }
            }
            .frame(maxWidth: 600) // Max width for iPad
            .background(Color("LyoBackground"))
            .cornerRadius(20)
            .padding(.top, 60) // Leave space at top
            .padding(.bottom, 0)
            .shadow(radius: 20)
            .transition(.move(edge: .bottom))
        }
    }
}
