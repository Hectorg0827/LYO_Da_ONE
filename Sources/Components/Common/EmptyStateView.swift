//
//  EmptyStateView.swift
//  Lyo
//
//  A reusable, premium empty state component used across the app
//  when the backend returns no data (Courses, Feeds, Campus, etc.)
//

import SwiftUI

struct EmptyStateView: View {
    let iconName: String
    let title: String
    let message: String
    let actionTitle: String?
    let action: (() -> Void)?
    
    init(
        iconName: String,
        title: String,
        message: String,
        actionTitle: String? = nil,
        action: (() -> Void)? = nil
    ) {
        self.iconName = iconName
        self.title = title
        self.message = message
        self.actionTitle = actionTitle
        self.action = action
    }
    
    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            
            // Icon
            ZStack {
                Circle()
                    .fill(DesignSystem.Colors.fallbackPrimary.opacity(0.1))
                    .frame(width: 100, height: 100)
                
                Image(systemName: iconName)
                    .font(.system(size: 40, weight: .light))
                    .foregroundColor(DesignSystem.Colors.fallbackPrimary)
            }
            
            // Text Content
            VStack(spacing: 8) {
                Text(title)
                    .font(.title2)
                    .fontWeight(.bold)
                    .foregroundColor(DesignSystem.Colors.textPrimary)
                    .multilineTextAlignment(.center)
                
                Text(message)
                    .font(.body)
                    .foregroundColor(DesignSystem.Colors.textSecondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            
            // Action Button
            if let actionTitle = actionTitle, let action = action {
                Button(action: action) {
                    Text(actionTitle)
                        .font(.headline)
                        .fontWeight(.semibold)
                        .foregroundColor(.white)
                        .padding(.vertical, 16)
                        .padding(.horizontal, 32)
                        .background(
                            LinearGradient(
                                colors: [
                                    DesignSystem.Colors.fallbackPrimary,
                                    DesignSystem.Colors.fallbackSecondary.opacity(0.8)
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .cornerRadius(30)
                        .shadow(color: DesignSystem.Colors.fallbackPrimary.opacity(0.3), radius: 10, x: 0, y: 5)
                }
                .padding(.top, 16)
                .buttonStyle(ScaleButtonStyle())
            }
            
            Spacer()
        }
        .padding()
        // Adding mild animation for a premium feel
        .transition(.opacity.combined(with: .scale(scale: 0.95)))
    }
}

#Preview {
    EmptyStateView(
        iconName: "book.closed",
        title: "No Courses Yet",
        message: "You haven't generated or saved any learning paths. Ask LYO to create your first course!",
        actionTitle: "Generate Course"
    ) {
        print("Action tapped")
    }
}
