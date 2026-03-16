import { useState } from 'react';
import Navbar from './components/Navbar';
import Topbar from './components/Topbar';
import ChatWindow from './components/ChatWindow';
import FloatingTags from './components/FloatingTags';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <>
      <Navbar />
      <Topbar />
      <ChatWindow />
      <FloatingTags sidebarOpen={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
    </>
  );
}
