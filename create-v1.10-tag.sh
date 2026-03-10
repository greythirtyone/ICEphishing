#!/bin/bash

# Script to create and push v1.10 tag to trigger Build and Release workflow
# This workflow is defined in .github/workflows/build-release.yml
#
# The build-release.yml workflow will:
# - Build binaries for Windows x64, Linux x64, macOS x64, and macOS arm64
# - Create a GitHub Release with auto-generated release notes
# - Attach all platform binaries as release assets
#
# Usage: ./create-v1.10-tag.sh

set -e

echo "========================================="
echo "Creating v1.10 Release Tag"
echo "========================================="
echo ""

# Check if tag already exists
if git rev-parse v1.10 >/dev/null 2>&1; then
    echo "⚠️  Tag v1.10 already exists locally."
    echo "If you want to recreate it, first delete it with: git tag -d v1.10"
    exit 1
fi

# Check current branch and ensure we're on main
current_branch=$(git branch --show-current)
if [ "$current_branch" != "main" ]; then
    echo "→ Currently on branch: $current_branch"
    echo "→ Switching to main branch..."
    
    # Check for uncommitted changes
    if ! git diff-index --quiet HEAD --; then
        echo "⚠️  You have uncommitted changes on $current_branch"
        echo "Please commit or stash your changes before proceeding."
        exit 1
    fi
    
    git checkout main
else
    echo "→ Already on main branch"
fi

echo "→ Pulling latest changes..."
git pull --ff-only origin main

# Create an annotated tag with message
echo "→ Creating annotated tag v1.10..."
git tag -a v1.10 -m "Release v1.10"

# Push the tag to trigger the workflow
echo "→ Pushing tag to origin..."
git push origin v1.10

echo ""
echo "========================================="
echo "✓ Tag v1.10 created and pushed!"
echo "========================================="
echo ""
echo "The 'Build and Release' workflow is now triggered."
echo ""
echo "Monitor progress at:"
echo "https://github.com/greythirtyone/ICEphishing/actions"
echo ""
echo "Once complete, the release will be available at:"
echo "https://github.com/greythirtyone/ICEphishing/releases/tag/v1.10"
echo ""
